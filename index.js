
(() => {
    "use strict"

    // Parameters
    const saveInterval = 60 // Bbox recovery save in seconds
    const fontBaseSize = 30 // Text size in pixels
    const fontColor = "#001f3f" // Base font color
    const borderColor = "#001f3f" // Base bbox border color
    const backgroundColor = "rgba(0, 116, 217, 0.2)" // Base bbox fill color
    const markedFontColor = "#ff4136" // Marked bbox font color
    const markedBorderColor = "#ff4136" // Marked bbox border color
    const markedBackgroundColor = "rgba(255, 133, 27, 0.2)" // Marked bbox fill color
    const minBBoxWidth = 5 // Minimal width of bbox
    const minBBoxHeight = 5 // Minimal height of bbox
    const minZoom = 0.1 // Smallest zoom allowed
    const maxZoom = 5 // Largest zoom allowed
    const resetCanvasOnChange = true // Whether to return to default position and zoom on image change
    const defaultScale = 0.5 // Default zoom level for images. Can be overridden with fittedZoom
    const drawCenterX = true // Whether to draw a cross in the middle of bbox
    const linePaddingPercent = 0.2 // Padding for cross
    const drawCursorGuidelines = true // Whether to draw guidelines for cursor

    let canvas = null

    // All annotation data and selections live here; see formats.js for the shapes of images, classes and bboxes
    const state = {
        images: {}, // Loaded image files by name, with their size and position in the image list
        classes: {}, // Class ids by name
        bboxes: {}, // Boxes by image name and class name
        currentImage: null, // Image shown on the canvas: { name, object, width, height, scale }
        currentImageRequest: 0, // Incremented per image switch so stale async loads can be ignored
        currentClass: null, // Class name given to new boxes
        currentBBox: null, // Selected box: { bbox, index, ... }
        imageListIndex: 0, // Selected row in the image list
        classListIndex: 0 // Selected row in the class list
    }

    /* Containers */
    const canvasID = 'canvas'
    const bboxInformationID = 'bboxInformation'
    const classListID = 'classList'
    const classesID = 'classes'
    const imageInformationID = 'imageInformation'
    const imagesID = 'images'
    const imageListID = 'imageList'
    const imageSearchID = 'imageSearch'
    const bboxesID = 'bboxes'
    const restoreBboxesID = 'restoreBboxes'
    const saveBBoxesID = 'saveBboxes'
    const saveBBoxesVOCID = 'saveVocBboxes'
    const vocFolderID = 'vocFolder'
    const saveBBoxesCOCOID = 'saveCocoBboxes'
    const cropImagesID = 'cropImages'

    // Keep tracking objects in drawing mode
    var isDrawingMode = false
    var drawingObject = null

    // Panning
    var isPanning = false
    let lastPosX = 0;
    let lastPosY = 0;
    // Prevent context menu on right click - it's used for panning
    document.addEventListener("contextmenu", function (e) {
        e.preventDefault()
    }, false)

    const isSupported = ()  => {
        try {
            const key = "__some_random_key_1234%(*^()^)___"

            localStorage.setItem(key, key)
            localStorage.removeItem(key)

            return true
        } catch (e) {
            return false
        }
    }

    // Save bboxes to local storage every X seconds
    if (isSupported() === true) {
        setInterval(() => {
            if (Object.keys(state.bboxes).length > 0) {
                localStorage.setItem("bboxes", JSON.stringify(state.bboxes))
            }
        }, saveInterval * 1000)
    } else {
        alert("Restore function is not supported. If you need it, use Chrome or Firefox instead.")
    }

    // Prevent accidental reloading
    window.onbeforeunload = function(){
        return 'Are you sure you want to leave the page?';
    };

    // Start everything
    document.onreadystatechange = () => {
        if (document.readyState === "complete") {
            initCanvas(canvasID, bboxInformationID)
            listenCanvasMouse(bboxInformationID)
            listenImageLoad(imageInformationID, imagesID, imageListID, bboxesID, restoreBboxesID)
            listenImageSelect(imageInformationID, imageListID)
            listenClassLoad(classListID, classesID, bboxesID, restoreBboxesID)
            listenClassSelect(classListID)
            listenBboxLoad(bboxesID)
            listenBboxSave(saveBBoxesID)
            listenBboxVocSave(saveBBoxesVOCID, vocFolderID)
            listenBboxCocoSave(saveBBoxesCOCOID)
            listenBboxRestore(restoreBboxesID)
            listenKeyboard(imageInformationID, imageListID, classListID)
            listenImageSearch(imageInformationID, imageSearchID, imageListID)
            listenImageCrop(cropImagesID)
        }
    }

    const initCanvas = (canvasContainerID, bboxInformationContainerID) => {

        canvas = new fabric.Canvas(canvasContainerID, {
            preserveObjectStacking: true,
            selection: false // Disable selection of multiple objects by "click+drag" or "shift+click"
        })
        canvas.setHeight(window.innerHeight - 20)
        canvas.setWidth(document.getElementById("right").clientWidth)

        if (drawCursorGuidelines === true) {
            canvas.hoverCursor = 'crosshair'
            canvas.on('mouse:move', function (opt) {
                const canvasMouse = canvas.getPointer(opt.e);
                drawGuidelines(canvas, canvasMouse, borderColor)
            })
        }
        drawIntro(canvas, { fontColor, markedFontColor, fontBaseSize: fontBaseSize * defaultScale })

        canvas.on('selection:created', changeCurrentBBox)
        canvas.on('selection:updated', changeCurrentBBox)
        // Otherwise Delete would still remove the last selected bbox's data while its rect stays on the canvas
        canvas.on('selection:cleared', () => {
            if (state.currentBBox !== null) {
                state.currentBBox.bbox.marked = false
                state.currentBBox = null
            }
        })
    }

    const changeCurrentBBox = (options) => {
        const event = options.e
        if (event === undefined) {
            return
        }
        const selectedObjects = options.selected;
        if (selectedObjects.length < 1) {
            return
        }
        const selectedObject = selectedObjects[0]
        const underlyingBBox = selectedObject.underlying_bbox

        const index = state.bboxes[state.currentImage.name][selectedObject.underlying_bbox.class].findIndex(
            element => (element.height === underlyingBBox.height) && (element.width === underlyingBBox.width) && (element.x === underlyingBBox.x) && (element.y === underlyingBBox.y)
        );

        state.currentBBox = {
            bbox: selectedObject.underlying_bbox,
            // index: bboxes[currentImage.name][selectedObject.underlying_bbox.class].length-1, // What was that? hidden memes?
            index: index,
            originalX: underlyingBBox.x,
            originalY: underlyingBBox.y,
            originalWidth: underlyingBBox.width,
            originalHeight: underlyingBBox.height,
            moving: false,
            resizing: null
        }
    }

    const refreshCanvas = () => {
        if (state.currentImage === null) {
            return
        }

        canvas.clear()
        drawImageScratch(state.currentImage, canvas)
        // drawNewBbox(context)
        drawExistingBboxes(bboxInformationID, canvas)
    }

    const drawExistingBboxes = (bboxInformationContainerID, canvas) => {
        const imgScale = state.currentImage.scale
        const currentBboxes = state.bboxes[state.currentImage.name]

        for (let className in currentBboxes) {
            currentBboxes[className].forEach(bbox => {

                // Draw bounding box itself
                const { rect, label, vertical, horizontal } = newRect(bbox, className, {
                    scale: imgScale,
                    rect_props: {
                        stroke: borderColor,
                        activeStroke: markedBorderColor,
                        strokeWidth: 1,
                        fill: backgroundColor,
                        activeFill: markedBackgroundColor,
                        opacity: 1.0,
                    },
                    label_props: {
                        fontSize: fontBaseSize * defaultScale,
                        fill: fontColor,
                        activeFill: markedFontColor,
                    },
                    cross_props: {
                        enabled: drawCenterX,
                        paddingPercentage: linePaddingPercent,
                        stroke: borderColor,
                        activeStroke: markedBorderColor,
                    },
                    container: { id: bboxInformationContainerID }
                })

                // Finally add the bounding box, label and possibly cross to the canvas
                canvas.add(rect)
                canvas.add(label)
                if (drawCenterX === true) {
                    canvas.add(vertical, horizontal)
                }
            })
        }
    }

    const listenCanvasMouse = (bboxInformationContainerID) => {
        canvas.on('mouse:wheel', trackWheel)
        canvas.on('mouse:down:before', wheelPanningStart)
        canvas.on('mouse:move', wheelPanningMove)
        canvas.on('mouse:up:before', wheelPanningDone)

        canvas.on('mouse:down:before', (event) => startNewRect(event, bboxInformationContainerID))
        canvas.on('mouse:move', eventDrawingRect)
        canvas.on('mouse:up', doneDrawingRect)
    }

    const wheelPanningStart = (event) => {
        // Make sure that panning started with WHEEL click
        if (event.e.button !== 1) {
            return
        }
        isPanning = true
        lastPosX = event.e.clientX;
        lastPosY = event.e.clientY;
    }

    const wheelPanningMove = (event) => {
        if (isPanning === false) {
            return
        }
        const deltaX = event.e.clientX - lastPosX;
        const deltaY = event.e.clientY - lastPosY;
        lastPosX = event.e.clientX;
        lastPosY = event.e.clientY;
        canvas.viewportTransform[4] += deltaX;
        canvas.viewportTransform[5] += deltaY;
        // canvas.requestRenderAll();
    }

    const wheelPanningDone = (event) => {
        if (isPanning === true && event.e.button === 1) {
            isPanning = false
        }
    }

    const startNewRect = (event, bboxInformationContainerID) => {
        // Make sure that drawing started with LEFT mouse click
        if (event.e.button !== 0) {
            return
        }
        // Pressing on an existing bbox (or the resize handles of the selected one) selects/moves it instead.
        // Anywhere else (background image, labels, empty canvas) draws, even while another bbox is selected.
        if (event.target && event.target.selectable) {
            return
        }
        if (state.currentImage === null || state.currentImage === undefined ||
            state.currentClass === null || state.currentClass === undefined) {
            // Prevent drawing new bounding box when no image or classname is selected
            return
        }
        if (canvas.getActiveObject()) {
            canvas.discardActiveObject()
        }
        const imgScale = state.currentImage.scale
        isDrawingMode = true
        const pointer = canvas.getPointer(event.e)
        
        const newBBox = canvasRectToBBox({left: pointer.x, top: pointer.y, width: 0, height: 0}, imgScale,
            state.currentClass)

        const { rect, label, vertical, horizontal } = newRect(newBBox, state.currentClass, {
            scale: imgScale,
            rect_props: {
                stroke: borderColor,
                activeStroke: markedBorderColor,
                strokeWidth: 1,
                fill: backgroundColor,
                activeFill: markedBackgroundColor,
                opacity: 1.0,
            },
            label_props: {
                fontSize: fontBaseSize * defaultScale,
                fill: fontColor,
                activeFill: markedFontColor,
            },
            cross_props: {
                enabled: drawCenterX,
                paddingPercentage: linePaddingPercent,
                stroke: borderColor,
                activeStroke: markedBorderColor,
            },
            container: { id: bboxInformationContainerID }
        })

        drawingObject = {
            rect: rect,
            label: label,
            vertical: vertical,
            horizontal: horizontal,
            bbox: newBBox,
        }

        canvas.add(drawingObject.rect)
        canvas.add(drawingObject.label)
        if (drawCenterX === true) {
            canvas.add(drawingObject.vertical, drawingObject.horizontal)
        }
        canvas.setActiveObject(drawingObject.rect) // @todo: this is not highlighing object, which is strange to me
    }
    
    const eventDrawingRect = (event) => {
        if (!isDrawingMode) {
            return
        }
        const pointer = canvas.getPointer(event.e)
        drawingObject.rect.set({
          width: pointer.x - drawingObject.rect.left,
          height: pointer.y - drawingObject.rect.top,
          dirty: true,
        })
        canvas.requestRenderAllBound() // Do we need this?
    }
    
    const doneDrawingRect = (event) => {
        if (!isDrawingMode) {
            return
        }
        isDrawingMode = false;
        
        // Try to evade negative values of width and height. It could happen when user draws from right to left or from bottom to top
        if (drawingObject.rect.width < 0) {
            const newWidth = Math.abs(drawingObject.rect.width);
            const newLeft = drawingObject.rect.left - newWidth;
            drawingObject.rect.set({
                left: newLeft,
                width: newWidth,
            })
        }
        if (drawingObject.rect.height < 0) {
            const newHeight = Math.abs(drawingObject.rect.height);
            const newTop = drawingObject.rect.top - newHeight;
            drawingObject.rect.set({
                top: newTop,
                height: newHeight,
            })
        }

        if (drawingObject.rect && (drawingObject.rect.width <= minBBoxWidth || drawingObject.rect.height <= minBBoxHeight)) {
            // Do not draw bounding box if it is too small
            canvas.remove(drawingObject.rect)
            canvas.remove(drawingObject.label)
            if (drawCenterX === true) {
                canvas.remove(drawingObject.vertical)
                canvas.remove(drawingObject.horizontal)
            }
            return
        }
        if (!drawingObject.rect) {
            console.log('Is it possible to reach this condition?')
        }
        drawingObject.rect.setCoords() // Do we need this?

        // Mock up options to trigger 'modified' event so bounding box is forced to be re-calculated
        const mockOptions = {
            target: {
                left: drawingObject.rect.left,
                top: drawingObject.rect.top,
                width: drawingObject.rect.width,
                height: drawingObject.rect.height,
                scaleX: 1,
                scaleY: 1,
            }
        };
        drawingObject.rect.fire('modified', mockOptions)
        canvas.setActiveObject(drawingObject.rect)
        // Simply store new bounding box
        saveBBox(state.bboxes, drawingObject.bbox, state.currentImage.name)
    }

    const canvasRectToBBox = (rect, scale, classname) => {
        const new_bbox = {
            x: rect.left / scale,
            y: rect.top / scale,
            width: rect.width / scale,
            height: rect.height / scale,
            marked: true,
            class: classname
        }
        return new_bbox
    }
    
    const saveBBox = (storage, bbox, imageName) => {
        if (typeof storage[imageName] === "undefined") {
            storage[imageName] = {}
        }
        if (typeof storage[imageName][bbox.class] === "undefined") {
            storage[imageName][bbox.class] = []
        }
        storage[imageName][bbox.class].push(bbox)
        state.currentBBox = {
            bbox: bbox,
            index: storage[imageName][bbox.class].length - 1,
            originalX: bbox.x,
            originalY: bbox.y,
            originalWidth: bbox.width,
            originalHeight: bbox.height,
            moving: false,
            resizing: null
        }
    }

    const trackWheel = (opt) => {
        const delta = opt.e.deltaY
        let zoom = canvas.getZoom()
        zoom *= 0.999 ** delta
        zoom = Math.min(maxZoom, zoom) // eq. to: if (zoom > maxZoom) zoom = maxZoom;
        zoom = Math.max(minZoom, zoom) // eq. to: if (zoom < minZoom) zoom = minZoom;
        // canvas.setZoom(zoom)
        canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom)
        opt.e.preventDefault()
        opt.e.stopPropagation()
    }

    const listenImageLoad = (imageInformationContainerID, imagesContainerID, imageListContainerID, bboxesContainerID, restoreBboxesContainerID) => {
        document.getElementById(imagesContainerID).addEventListener("change", async (event) => {
            const imageList = document.getElementById(imageListContainerID)
            const files = event.target.files

            if (files.length === 0) {
                return
            }

            resetImageList(imageListContainerID)

            for (let i = 0; i < files.length; i++) {
                if (Formats.isImageFile(files[i].name)) {
                    // Position in the image list; skipped non-image files must not leave gaps
                    const index = imageList.length

                    state.images[files[i].name] = {
                        meta: files[i],
                        index: index
                    }

                    const option = document.createElement("option")

                    option.value = files[i].name
                    option.textContent = files[i].name

                    if (index === 0) {
                        option.selected = true
                    }

                    imageList.appendChild(option)
                }
            }

            const imageSet = state.images // Loads from an earlier selection must not touch a newer image set
            const imageNames = Object.keys(imageSet)
            const failed = []

            if (imageNames.length === 0) {
                document.body.style.cursor = "default" // An earlier, superseded load may have set "wait"

                return
            }

            document.body.style.cursor = "wait"

            // Decode every image once to learn its size, which the annotation formats need
            await Promise.all(imageNames.map((imageName) => loadImage(imageSet[imageName].meta)
                .then((imageObject) => {
                    imageSet[imageName].width = imageObject.width
                    imageSet[imageName].height = imageObject.height
                }, () => {
                    failed.push(imageName)
                })))

            if (state.images !== imageSet) {
                return
            }

            document.body.style.cursor = "default"

            if (failed.length > 0) {
                const more = failed.length > 10 ? `\n...and ${failed.length - 10} more` : ""

                console.warn(`Could not decode ${failed.length} image(s):`, failed)
                alert(`Could not load ${failed.length} image(s); they can't be annotated or exported:\n\n` +
                    `${failed.slice(0, 10).join("\n")}${more}`)
            }

            const firstLoaded = imageNames.find((name) => typeof state.images[name].width !== "undefined")

            if (typeof firstLoaded !== "undefined") {
                state.imageListIndex = state.images[firstLoaded].index
                imageList.selectedIndex = state.imageListIndex

                setCurrentImage(imageInformationContainerID, state.images[firstLoaded])
            }

            if (Object.keys(state.classes).length > 0) {
                document.getElementById(bboxesContainerID).disabled = false
                document.getElementById(restoreBboxesContainerID).disabled = false
            }
        })
    }

    const resetImageList = (imageListContainerID) => {
        const imageList = document.getElementById(imageListContainerID)

        imageList.innerHTML = ""

        state.images = {}
        state.bboxes = {}
        state.currentImage = null
        state.currentImageRequest++
        state.imageListIndex = 0
    }

    const setCurrentImage = async (imageInformationContainerID, imageFile) => {
        if (resetCanvasOnChange === true) {
            resetCanvasPlacement()
        }

        const request = ++state.currentImageRequest

        if (state.currentBBox !== null) {
            state.currentBBox.bbox.marked = false // We unmark via reference
            state.currentBBox = null // and the we delete
        }

        document.getElementById(imageInformationContainerID).innerHTML =
            `${imageFile.width}x${imageFile.height}, ${formatBytes(imageFile.meta.size)}`

        let imageObject = null

        try {
            imageObject = await loadImage(imageFile.meta)
        } catch (error) {
            console.warn(error.message)

            return
        }

        // Another image was selected while this one was loading
        if (request !== state.currentImageRequest) {
            return
        }

        state.currentImage = {
            name: imageFile.meta.name,
            object: imageObject,
            width: imageFile.width,
            height: imageFile.height,
            scale: 1.0
        }
        refreshCanvas()
    }

    const listenImageSelect = (imageInformationContainerID, imageListContainerID) => {
        const imageList = document.getElementById(imageListContainerID)

        imageList.addEventListener("change", () => {
            state.imageListIndex = imageList.selectedIndex

            setCurrentImage(imageInformationContainerID, state.images[imageList.options[state.imageListIndex].value])
        })
    }

    const listenClassLoad = (classesListContainerID, classesContainerID, bboxesContainerID, restoreBboxesContainerID) => {
        const classesElement = document.getElementById(classesContainerID)
    
        classesElement.addEventListener("click", () => {
            classesElement.value = null
        })
    
        classesElement.addEventListener("change", async (event) => {
            const files = event.target.files

            if (files.length === 0) {
                return
            }

            resetClassList(classesListContainerID)

            const extension = Formats.extensionOf(files[0].name)

            if (extension !== "txt" && extension !== "names") {
                return
            }

            const text = await readText(files[0])
            const classList = document.getElementById(classesListContainerID)

            // Ids count non-empty rows only, so blank lines don't shift them
            Formats.parseClasses(text).forEach((className, id) => {
                state.classes[className] = id

                const option = document.createElement("option")

                option.value = id
                option.textContent = className

                if (id === 0) {
                    option.selected = true
                    state.currentClass = className
                }

                classList.appendChild(option)
            })

            if (classList.length > 0) {
                setCurrentClass(classesListContainerID)
            }

            if (Object.keys(state.images).length > 0) {
                document.getElementById(bboxesContainerID).disabled = false
                document.getElementById(restoreBboxesContainerID).disabled = false
            }
        })
    }

    const resetClassList = (classesListContainerID) => {
        document.getElementById(classesListContainerID).innerHTML = ""

        state.classes = {}
        state.currentClass = null
        state.classListIndex = 0
    }

    const setCurrentClass = (classesListContainerID) => {
        const classList = document.getElementById(classesListContainerID)

        state.currentClass = classList.options[classList.selectedIndex].text

        if (state.currentBBox !== null) {
            state.currentBBox.bbox.marked = false // We unmark via reference
            state.currentBBox = null // and the we delete
        }
    }

    const listenClassSelect = (classesListContainerID) => {
        const classList = document.getElementById(classesListContainerID)

        classList.addEventListener("change", () => {
            state.classListIndex = classList.selectedIndex

            setCurrentClass(classesListContainerID)
        })
    }

    const listenBboxLoad = (bboxesContainerID) => {
        const bboxesElement = document.getElementById(bboxesContainerID)
    
        bboxesElement.addEventListener("click", () => {
            bboxesElement.value = null
        })
    
        bboxesElement.addEventListener("change", async (event) => {
            const files = Array.from(event.target.files)

            if (files.length === 0) {
                return
            }

            resetBboxes()

            // Each file reports its own errors, so the canvas is always redrawn at the end
            await Promise.all(files.map(loadAnnotationSource))

            refreshCanvas()
        })
    }

    // Reads one picked annotation file, or a zip of them
    const loadAnnotationSource = async (file) => {
        const extension = Formats.extensionOf(file.name)

        if (extension === "txt" || extension === "xml" || extension === "json") {
            try {
                storeBbox(file.name, await readText(file))
            } catch (error) {
                alert(`Could not read ${file.name}: ${error.message}`)
            }

            return
        }

        let archive = null

        try {
            archive = await new JSZip().loadAsync(await readArrayBuffer(file))
        } catch (error) {
            alert(`Could not read ${file.name} as a zip archive: ${error.message}`)

            return
        }

        // Skip folders and macOS metadata (__MACOSX/, ._name)
        const entries = Object.keys(archive.files).filter((filename) => !archive.files[filename].dir &&
            !filename.startsWith("__MACOSX/") && !Formats.baseName(filename).startsWith("._"))
        const failed = []

        await Promise.all(entries.map(async (filename) => {
            try {
                // Match labels to images by file name, whatever folder they are in
                storeBbox(Formats.baseName(filename), await archive.file(filename).async("string"))
            } catch (error) {
                failed.push(`${filename}: ${error.message}`)
            }
        }))

        if (failed.length > 0) {
            console.warn(`Could not read from ${file.name}:`, failed)
            alert(`Could not read ${failed.length} file(s) from ${file.name}:\n\n${failed.slice(0, 10).join("\n")}`)
        }
    }

    const resetBboxes = () => {
        state.bboxes = {}
    }

    // Adds the boxes of one annotation file (.txt/.xml/.json, other files are ignored) to the loaded images
    const storeBbox = (filename, text) => {
        const {boxes, unmatched} = Formats.parseAnnotationFile(filename, text, state.images, state.classes)

        Object.keys(boxes).forEach((imageName) => {
            if (typeof state.bboxes[imageName] === "undefined") {
                state.bboxes[imageName] = {}
            }

            boxes[imageName].forEach((bbox) => {
                if (typeof state.bboxes[imageName][bbox.class] === "undefined") {
                    state.bboxes[imageName][bbox.class] = []
                }

                state.bboxes[imageName][bbox.class].push(bbox)
            })
        })

        if (unmatched > 0) {
            console.warn(`${filename}: skipped ${unmatched} annotation(s) whose image is not loaded`)
        }
    }

    const reportSkipped = (format, skipped) => {
        if (skipped.length === 0) {
            return
        }

        console.warn(`${format} export: skipped ${skipped.length} annotated image(s) not in the loaded image set:`,
            skipped)

        const shown = skipped.slice(0, 10).join("\n")
        const more = skipped.length > 10 ? `\n...and ${skipped.length - 10} more` : ""

        alert(`${format} export: skipped ${skipped.length} annotated image(s) that are not in the loaded image set ` +
            `(see console for the full list):\n\n${shown}${more}`)
    }

    // Warns about boxes left out because their class isn't in the loaded class list (see Formats.exportYolo)
    const reportUnknownClasses = (format, unknownClasses) => {
        const names = Object.keys(unknownClasses)

        if (names.length === 0) {
            return
        }

        const list = names.map((name) => `${name} (${unknownClasses[name]} box(es))`).join("\n")

        console.warn(`${format} export: skipped boxes with classes not in the loaded class list:`, unknownClasses)

        alert(`${format} export: skipped boxes whose class is not in the loaded class list:\n\n${list}`)
    }

    const downloadZip = (files, zipName) => {
        const zip = new JSZip()

        Object.keys(files).forEach((fileName) => zip.file(fileName, files[fileName]))

        zip.generateAsync({type: "blob"})
            .then((blob) => {
                saveAs(blob, zipName)
            })
    }

    const listenBboxSave = (saveBBoxesContainerID) => {
        document.getElementById(saveBBoxesContainerID).addEventListener("click", () => {
            const {files, skipped, unknownClasses} = Formats.exportYolo(state.bboxes, state.images, state.classes)

            reportSkipped("YOLO", skipped)
            reportUnknownClasses("YOLO", unknownClasses)
            downloadZip(files, "bboxes_yolo.zip")
        })
    }

    const listenBboxVocSave = (saveBBoxesVOCContainerID, vocFolderContainerID) => {
        document.getElementById(saveBBoxesVOCContainerID).addEventListener("click", () => {
            const folderPath = document.getElementById(vocFolderContainerID).value
            const {files, skipped} = Formats.exportVoc(state.bboxes, state.images, folderPath)

            reportSkipped("VOC", skipped)
            downloadZip(files, "bboxes_voc.zip")
        })
    }

    const listenBboxCocoSave = (saveBBoxesCOCOContainerID) => {
        document.getElementById(saveBBoxesCOCOContainerID).addEventListener("click", () => {
            const {files, skipped, unknownClasses} = Formats.exportCoco(state.bboxes, state.images, state.classes)

            reportSkipped("COCO", skipped)
            reportUnknownClasses("COCO", unknownClasses)
            downloadZip(files, "bboxes_coco.zip")
        })
    }


    const listenBboxRestore = (restoreBboxesContainerID) => {
        document.getElementById(restoreBboxesContainerID).addEventListener("click", () => {
            const item = localStorage.getItem("bboxes")

            if (item) {
                state.bboxes = JSON.parse(item)
                state.currentBBox = null

                // The backup is shared by all image sets, so it may hold boxes for images that aren't loaded
                const unmatched = Object.keys(state.bboxes).filter((imageName) =>
                    typeof state.images[imageName] === "undefined" &&
                    Object.values(state.bboxes[imageName]).some((classBboxes) => classBboxes.length > 0))

                if (unmatched.length > 0) {
                    const more = unmatched.length > 10 ? `\n...and ${unmatched.length - 10} more` : ""

                    console.warn("Restored boxes for images that are not loaded:", unmatched)
                    alert(`Restored boxes for ${unmatched.length} image(s) that are not in the loaded image set. ` +
                        `They are kept, but skipped on export:\n\n${unmatched.slice(0, 10).join("\n")}${more}`)
                }

                refreshCanvas()
            }
        })
    }

    const listenKeyboard = (imageInformationContainerID, imageListContainerID, classListContainerID) => {
        const imageList = document.getElementById(imageListContainerID)
        const classList = document.getElementById(classListContainerID)
    
        document.addEventListener("keydown", (event) => {
            const target = event.target

            // Leave Delete/arrow keys to the field while typing (image search, VOC folder)
            if (target && (target.tagName === "TEXTAREA" ||
                (target.tagName === "INPUT" && /^(text|search)$/i.test(target.type)))) {
                return
            }

            const key = event.keyCode || event.charCode
            // Delete
            if (key === 46 || (key === 8 && event.metaKey === true)) {
                if (state.currentBBox !== null) {
                    const {bbox, index} = state.currentBBox

                    state.bboxes[state.currentImage.name][bbox.class].splice(index, 1)
                    state.currentBBox = null
                    document.body.style.cursor = "default"
                    canvas.remove(canvas.getActiveObject())
                }
                event.preventDefault()
            }
            // Arrow left
            if (key === 37) {
                if (imageList.length > 1) {
                    imageList.options[state.imageListIndex].selected = false
                    if (state.imageListIndex === 0) {
                        state.imageListIndex = imageList.length - 1
                    } else {
                        state.imageListIndex--
                    }
                    imageList.options[state.imageListIndex].selected = true
                    imageList.selectedIndex = state.imageListIndex
                    setCurrentImage(imageInformationContainerID,
                        state.images[imageList.options[state.imageListIndex].value])
                    document.body.style.cursor = "default"
                }
                event.preventDefault()
            }
            // Arrow right
            if (key === 39) {
                if (imageList.length > 1) {
                    imageList.options[state.imageListIndex].selected = false
                    if (state.imageListIndex === imageList.length - 1) {
                        state.imageListIndex = 0
                    } else {
                        state.imageListIndex++
                    }
                    imageList.options[state.imageListIndex].selected = true
                    imageList.selectedIndex = state.imageListIndex
                    setCurrentImage(imageInformationContainerID,
                        state.images[imageList.options[state.imageListIndex].value])
                    document.body.style.cursor = "default"
                }
                event.preventDefault()
            }
            // Arrow up
            if (key === 38) {
                if (classList.length > 1) {
                    classList.options[state.classListIndex].selected = false
                    if (state.classListIndex === 0) {
                        state.classListIndex = classList.length - 1
                    } else {
                        state.classListIndex--
                    }
                    classList.options[state.classListIndex].selected = true
                    classList.selectedIndex = state.classListIndex
                    setCurrentClass(classListContainerID)
                }
                event.preventDefault()
            }
            // Arrow down
            if (key === 40) {
                if (classList.length > 1) {
                    classList.options[state.classListIndex].selected = false
                    if (state.classListIndex === classList.length - 1) {
                        state.classListIndex = 0
                    } else {
                        state.classListIndex++
                    }
                    classList.options[state.classListIndex].selected = true
                    classList.selectedIndex = state.classListIndex
                    setCurrentClass(classListContainerID)
                }
                event.preventDefault()
            }
        })
    }

    const resetCanvasPlacement = () => {
        // @todo: when image changes we need to reset zooms/scales and etc.
    }

    const listenImageSearch = (imageInformationContainerID, imageSearchContainerID, imageListContainerID) => {
        document.getElementById(imageSearchContainerID).addEventListener("input", (event) => {
            const value = event.target.value

            for (let imageName in state.images) {
                if (imageName.indexOf(value) !== -1) {
                    state.imageListIndex = state.images[imageName].index
                    document.getElementById(imageListContainerID).selectedIndex = state.imageListIndex

                    setCurrentImage(imageInformationContainerID, state.images[imageName])

                    break
                }
            }
        })
    }

    const listenImageCrop = (cropImagesContainerID) => {
        document.getElementById(cropImagesContainerID).addEventListener("click", async () => {
            const {crops, skipped} = Formats.cropRegions(state.bboxes, state.images)
            const decoded = {} // One decode per image, shared by all its crops
            const files = {}

            reportSkipped("Crop", skipped)

            if (crops.length === 0) {
                return
            }

            document.body.style.cursor = "wait" // Mark as busy

            try {
                await Promise.all(crops.map(async ({imageName, image, bbox, fileName}) => {
                    decoded[imageName] = decoded[imageName] || loadImage(image.meta)

                    let imageObject = null

                    try {
                        imageObject = await decoded[imageName]
                    } catch (error) {
                        console.warn(`Crop: could not decode ${imageName}`)

                        return
                    }

                    const temporaryCanvas = document.createElement("canvas")

                    temporaryCanvas.width = bbox.width
                    temporaryCanvas.height = bbox.height
                    temporaryCanvas.getContext("2d").drawImage(imageObject, bbox.x, bbox.y, bbox.width, bbox.height,
                        0, 0, bbox.width, bbox.height)

                    const blob = await canvasToBlob(temporaryCanvas, image.meta.type)

                    if (blob !== null) {
                        files[fileName] = blob
                    } else {
                        console.warn(`Crop: empty crop ${fileName} skipped`)
                    }
                }))
            } finally {
                document.body.style.cursor = "default"
            }

            downloadZip(files, "crops.zip")
        })
    }
})()
