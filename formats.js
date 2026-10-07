/* global module */
// Conversion between the in-memory annotations and YOLO, Pascal VOC and COCO files.
// Nothing here touches the page or the app state, so it can be tested on its own (see tests/).
//
// Data shapes:
//   images:  { [imageName]: { width, height, index } }  width/height are undefined until the image is decoded
//   classes: { [className]: id }                         ids are 0..n-1 in class file order
//   bboxes:  { [imageName]: { [className]: [{ x, y, width, height, marked, class }] } }  in image pixels
const Formats = (() => {
    "use strict"

    const imageExtensions = ["jpg", "jpeg", "png", "JPG", "JPEG", "PNG", "bmp", "BMP"]

    const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

    const extensionOf = (filename) => filename.split(".").pop()
        .toLowerCase()

    // File name without folders; annotation files are matched to images by name only
    const baseName = (path) => String(path).split(/[\\/]/)
        .pop()

    const replaceExtension = (filename, extension) => {
        const parts = filename.split(".")

        parts[parts.length - 1] = extension

        return parts.join(".")
    }

    const isImageFile = (filename) => imageExtensions.indexOf(filename.split(".").pop()) !== -1

    const newBbox = (x, y, width, height, className) => ({
        x: x,
        y: y,
        width: width,
        height: height,
        marked: false,
        class: className
    })

    const isLoaded = (images, imageName) => hasOwn(images, imageName) && typeof images[imageName].width !== "undefined"

    // Clips a bbox to the image bounds without modifying it; returns null if nothing of it lies inside the image
    const clampBbox = (bbox, image) => {
        const x1 = Math.max(0, Math.min(bbox.x, bbox.x + bbox.width))
        const y1 = Math.max(0, Math.min(bbox.y, bbox.y + bbox.height))
        const x2 = Math.min(image.width, Math.max(bbox.x, bbox.x + bbox.width))
        const y2 = Math.min(image.height, Math.max(bbox.y, bbox.y + bbox.height))

        if (x2 <= x1 || y2 <= y1) {
            return null
        }

        return {x: x1, y: y1, width: x2 - x1, height: y2 - y1}
    }

    const escapeXml = (value) => String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")

    // Class names in a classes file, one per non-empty row; the position is the YOLO class id
    const parseClasses = (text) => text.split(/[\r\n]+/)
        .map((row) => row.trim())
        .filter((row) => row !== "")

    // Checks a file picked as the classes file before it replaces the class list. Annotation files are
    // easy to pick there by mistake, so they get a hint to use the Bboxes field instead.
    // Returns { classes } or { error }.
    const readClassFile = (fileName, text) => {
        const extension = extensionOf(fileName)
        const useBboxes = "Load annotation files with the Bboxes field instead."

        if (extension === "json") {
            return {error: `${fileName} looks like COCO annotations, not a class list. ${useBboxes} ` +
                "If no classes are loaded, the class list is filled from its categories."}
        }

        if (extension === "xml" || extension === "zip") {
            return {error: `${fileName} looks like annotations, not a class list. ${useBboxes}`}
        }

        if (extension !== "txt" && extension !== "names") {
            return {error: `${fileName} is not a class list. Use a .txt or .names file with one class name per line.`}
        }

        const start = text.trim().charAt(0)

        if (start === "{" || start === "[" || start === "<") {
            return {error: `${fileName} contains JSON or XML, not one class name per line. ` +
                "If it holds annotations, load it with the Bboxes field instead."}
        }

        const classes = parseClasses(text)

        if (classes.length === 0) {
            return {error: `${fileName} contains no class names.`}
        }

        if (classes.every((row) => /^\d+(\s+[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?){4}$/i.test(row))) {
            return {error: `${fileName} looks like a YOLO label file ("class x y width height" rows), ` +
                `not a class list. ${useBboxes}`}
        }

        const duplicates = classes.filter((name, i) => classes.indexOf(name) !== i)

        if (duplicates.length > 0) {
            return {error: `${fileName} lists these classes more than once, so their ids would be ambiguous: ` +
                `${duplicates.filter((name, i) => duplicates.indexOf(name) === i).join(", ")}`}
        }

        return {classes}
    }

    /* Reading annotations */

    // One "class cx cy w h" row per box, normalised to 0..1. Rows with unknown class ids are ignored.
    const parseYolo = (text, image, classes) => {
        const names = Object.keys(classes)
        const result = []

        text.split(/[\r\n]+/).forEach((row) => {
            const cols = row.trim().split(/\s+/)

            if (cols.length < 5) {
                return
            }

            const id = parseInt(cols[0])
            const className = names.find((name) => classes[name] === id)

            if (typeof className === "undefined") {
                return
            }

            // Not rounded, so that loading and saving again gives the same values
            const width = parseFloat(cols[3]) * image.width
            const x = parseFloat(cols[1]) * image.width - width * 0.5
            const height = parseFloat(cols[4]) * image.height
            const y = parseFloat(cols[2]) * image.height - height * 0.5

            result.push(newBbox(x, y, width, height, className))
        })

        return result
    }

    // Pascal VOC XML. Objects with unknown class names are ignored. Needs the browser's DOMParser.
    const parseVoc = (text, classes) => {
        const xmlDoc = new DOMParser().parseFromString(text, "text/xml")
        const objects = xmlDoc.getElementsByTagName("object")
        const valueOf = (element, tagName) => element.getElementsByTagName(tagName)[0].childNodes[0].nodeValue
        const result = []

        for (let i = 0; i < objects.length; i++) {
            const className = valueOf(objects[i], "name")

            if (hasOwn(classes, className)) {
                const bndBox = objects[i].getElementsByTagName("bndbox")[0]
                const xMin = parseInt(valueOf(bndBox, "xmin"))
                const yMin = parseInt(valueOf(bndBox, "ymin"))

                result.push(newBbox(xMin, yMin, parseInt(valueOf(bndBox, "xmax")) - xMin,
                    parseInt(valueOf(bndBox, "ymax")) - yMin, className))
            }
        }

        return result
    }

    // COCO JSON with many images. Returns boxes per loaded image (an entry, possibly empty, for every loaded
    // image the file annotates) and how many annotations belong to images that aren't loaded.
    const parseCoco = (text, images, classes) => {
        const json = JSON.parse(text)
        const boxes = {}
        let unmatched = 0

        json.annotations.forEach((annotation) => {
            // file_name often includes a folder (e.g. "images/a.jpg"); match by name only
            const image = json.images.find((candidate) => candidate.id === annotation.image_id &&
                hasOwn(images, baseName(candidate.file_name)))

            if (typeof image === "undefined") {
                unmatched++

                return
            }

            const imageName = baseName(image.file_name)
            const category = json.categories.find((candidate) => candidate.id === annotation.category_id)

            boxes[imageName] = boxes[imageName] || []

            if (typeof category !== "undefined" && hasOwn(classes, category.name)) {
                const [x, y, width, height] = annotation.bbox

                boxes[imageName].push(newBbox(x, y, width, height, category.name))
            }
        })

        return {boxes, unmatched}
    }

    // Class names of a COCO JSON file in category id order, which is how exportCoco numbers them.
    // Empty and repeated names are left out.
    const cocoClassNames = (text) => {
        const categories = (JSON.parse(text).categories || [])
            .filter((category) => typeof category.name === "string" && category.name.trim() !== "")
            .sort((a, b) => a.id - b.id)
        const names = []

        categories.forEach((category) => {
            if (names.indexOf(category.name) === -1) {
                names.push(category.name)
            }
        })

        return names
    }

    // Reads one annotation file of any supported type (.txt, .xml, .json; other files are ignored).
    // YOLO and VOC files apply to every loaded image with the same name and an image extension.
    // Returns { boxes: { [imageName]: [bbox] }, unmatched } like parseCoco.
    const parseAnnotationFile = (filename, text, images, classes) => {
        const extension = extensionOf(filename)

        if (extension === "json") {
            return parseCoco(text, images, classes)
        }

        const boxes = {}

        if (extension === "txt" || extension === "xml") {
            const stem = filename.slice(0, -(extension.length + 1))

            imageExtensions.forEach((imageExtension) => {
                const imageName = `${stem}.${imageExtension}`

                if (hasOwn(images, imageName)) {
                    boxes[imageName] = extension === "txt" ? parseYolo(text, images[imageName], classes)
                        : parseVoc(text, classes)
                }
            })
        }

        return {boxes, unmatched: 0}
    }

    /* Writing annotations */

    // Annotated images that are loaded, in bboxes order. The others (e.g. restored from a backup of another
    // image set) can't be exported because their size is unknown; their names are returned in `skipped`.
    const exportableImages = (bboxes, images) => {
        const entries = []
        const skipped = []

        Object.keys(bboxes).forEach((imageName) => {
            if (isLoaded(images, imageName)) {
                entries.push({imageName, image: images[imageName], classBboxes: bboxes[imageName]})
            } else {
                skipped.push(imageName)
            }
        })

        return {entries, skipped}
    }

    // Classes in the annotations that are not in the class list, e.g. after loading another classes file.
    // Their boxes have no class id, so YOLO and COCO skip them; the counts are reported in `unknownClasses`.
    const knownClassBboxes = (classBboxes, classes, unknownClasses) => Object.keys(classBboxes).filter((className) => {
        if (hasOwn(classes, className)) {
            return true
        }

        if (classBboxes[className].length > 0) {
            unknownClasses[className] = (unknownClasses[className] || 0) + classBboxes[className].length
        }

        return false
    })

    // Boxes of one class clipped to the image, leaving out those entirely outside it
    const clampedBboxes = (bboxList, image) => bboxList.map((bbox) => clampBbox(bbox, image))
        .filter((bbox) => bbox !== null)

    // One .txt per annotated image (empty if it has no boxes, which marks it as background)
    const exportYolo = (bboxes, images, classes) => {
        const {entries, skipped} = exportableImages(bboxes, images)
        const unknownClasses = {}
        const files = {}

        entries.forEach(({imageName, image, classBboxes}) => {
            const rows = []

            knownClassBboxes(classBboxes, classes, unknownClasses).forEach((className) => {
                clampedBboxes(classBboxes[className], image).forEach((bbox) => {
                    const x = (bbox.x + bbox.width / 2) / image.width
                    const y = (bbox.y + bbox.height / 2) / image.height
                    const width = bbox.width / image.width
                    const height = bbox.height / image.height

                    rows.push(`${classes[className]} ${x} ${y} ${width} ${height}`)
                })
            })

            files[replaceExtension(imageName, "txt")] = rows.join("\n")
        })

        return {files, skipped, unknownClasses}
    }

    // One .xml per annotated image that has at least one box. VOC stores class names, so any class is kept.
    const exportVoc = (bboxes, images, folder) => {
        const {entries, skipped} = exportableImages(bboxes, images)
        const files = {}

        entries.forEach(({imageName, image, classBboxes}) => {
            const objects = []

            Object.keys(classBboxes).forEach((className) => {
                clampedBboxes(classBboxes[className], image).forEach((bbox) => {
                    objects.push(
                        "<object>",
                        `<name>${escapeXml(className)}</name>`,
                        "<pose>Unspecified</pose>",
                        "<truncated>0</truncated>",
                        "<occluded>0</occluded>",
                        "<difficult>0</difficult>",
                        "<bndbox>",
                        `<xmin>${Math.round(bbox.x)}</xmin>`,
                        `<ymin>${Math.round(bbox.y)}</ymin>`,
                        `<xmax>${Math.round(bbox.x + bbox.width)}</xmax>`,
                        `<ymax>${Math.round(bbox.y + bbox.height)}</ymax>`,
                        "</bndbox>",
                        "</object>"
                    )
                })
            })

            if (objects.length === 0) {
                return
            }

            files[replaceExtension(imageName, "xml")] = [
                "<?xml version=\"1.0\"?>",
                "<annotation>",
                `<folder>${escapeXml(folder)}</folder>`,
                `<filename>${escapeXml(imageName)}</filename>`,
                "<path/>",
                "<source>",
                "<database>Unknown</database>",
                "</source>",
                "<size>",
                `<width>${image.width}</width>`,
                `<height>${image.height}</height>`,
                "<depth>3</depth>",
                "</size>",
                "<segmented>0</segmented>",
                ...objects,
                "</annotation>"
            ].join("\n")
        })

        return {files, skipped}
    }

    // A single coco.json listing every loaded image, annotated or not. Ids are 1-based.
    const exportCoco = (bboxes, images, classes) => {
        const {entries, skipped} = exportableImages(bboxes, images)
        const unknownClasses = {}
        const result = {
            images: Object.keys(images).map((imageName) => ({
                id: images[imageName].index + 1,
                file_name: imageName, //eslint-disable-line camelcase
                width: images[imageName].width,
                height: images[imageName].height
            })),
            type: "instances",
            annotations: [],
            categories: Object.keys(classes).map((className) => ({
                supercategory: "none",
                id: classes[className] + 1,
                name: className
            }))
        }

        entries.forEach(({image, classBboxes}) => {
            knownClassBboxes(classBboxes, classes, unknownClasses).forEach((className) => {
                clampedBboxes(classBboxes[className], image).forEach((bbox) => {
                    result.annotations.push({
                        segmentation: [[
                            bbox.x, bbox.y,
                            bbox.x, bbox.y + bbox.height,
                            bbox.x + bbox.width, bbox.y + bbox.height,
                            bbox.x + bbox.width, bbox.y
                        ]],
                        area: bbox.width * bbox.height,
                        iscrowd: 0,
                        ignore: 0,
                        image_id: image.index + 1, //eslint-disable-line camelcase
                        bbox: [bbox.x, bbox.y, bbox.width, bbox.height],
                        category_id: classes[className] + 1, //eslint-disable-line camelcase
                        id: result.annotations.length + 1
                    })
                })
            })
        })

        return {files: {"coco.json": JSON.stringify(result)}, skipped, unknownClasses}
    }

    // Image regions to cut out for Crop&Save, clipped to the image, named "<image>-<class>-<n>.<ext>"
    const cropRegions = (bboxes, images) => {
        const {entries, skipped} = exportableImages(bboxes, images)
        const crops = []

        entries.forEach(({imageName, image, classBboxes}) => {
            Object.keys(classBboxes).forEach((className) => {
                classBboxes[className].forEach((original, i) => {
                    const bbox = clampBbox(original, image)

                    if (bbox !== null) {
                        const nameParts = imageName.split(".")

                        nameParts[nameParts.length - 2] += `-${className}-${i}`

                        crops.push({imageName, image, bbox, fileName: nameParts.join(".")})
                    }
                })
            })
        })

        return {crops, skipped}
    }

    return {
        imageExtensions,
        isImageFile,
        extensionOf,
        baseName,
        clampBbox,
        escapeXml,
        parseClasses,
        readClassFile,
        parseYolo,
        parseVoc,
        parseCoco,
        cocoClassNames,
        parseAnnotationFile,
        exportYolo,
        exportVoc,
        exportCoco,
        cropRegions
    }
})()

if (typeof module !== "undefined" && module.exports) {
    module.exports = Formats
}
