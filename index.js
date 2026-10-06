
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

    // Main containers
    let canvas = null
    let images = {}
    let classes = {}
    let bboxes = {}

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

    const extensions = ["jpg", "jpeg", "png", "JPG", "JPEG", "PNG", "bmp", "BMP"]

    let currentImage = null
    let currentImageRequest = 0 // Incremented per image switch so stale async loads can be ignored
    let currentClass = null
    let currentBBox = null
    let imageListIndex = 0
    let classListIndex = 0

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
            if (Object.keys(bboxes).length > 0) {
                localStorage.setItem("bboxes", JSON.stringify(bboxes))
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
            if (currentBBox !== null) {
                currentBBox.bbox.marked = false
                currentBBox = null
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

        const index = bboxes[currentImage.name][selectedObject.underlying_bbox.class].findIndex(
            element => (element.height === underlyingBBox.height) && (element.width === underlyingBBox.width) && (element.x === underlyingBBox.x) && (element.y === underlyingBBox.y)
        );

        currentBBox = {
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
        canvas.clear()
        drawImageScratch(currentImage, canvas)
        // drawNewBbox(context)
        drawExistingBboxes(bboxInformationID, canvas)
    }

    const drawExistingBboxes = (bboxInformationContainerID, canvas) => {
        const imgScale = currentImage.scale
        const currentBboxes = bboxes[currentImage.name]

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
        if (canvas.getActiveObject()) {
            return
        }
        if (canvas.getActiveObject() || currentImage === null || currentImage === undefined || currentClass === null || currentClass === undefined) {
            // Prevent drawing new bounding box when no image or classname is selected
            // If some an existing object is currently selected prevent drawing also
            return
        }
        const imgScale = currentImage.scale
        isDrawingMode = true
        const pointer = canvas.getPointer(event.e)
        
        const newBBox = canvasRectToBBox({left: pointer.x, top: pointer.y, width: 0, height: 0}, imgScale, currentClass)

        const { rect, label, vertical, horizontal } = newRect(newBBox, currentClass, {
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
        saveBBox(bboxes, drawingObject.bbox, currentImage.name)
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
        currentBBox = {
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
        document.getElementById(imagesContainerID).addEventListener("change", (event) => {
            const imageList = document.getElementById(imageListContainerID)
    
            const files = event.target.files
    
            if (files.length > 0) {
                resetImageList(imageListContainerID)
    
                document.body.style.cursor = "wait"
    
                for (let i = 0; i < files.length; i++) {
                    const nameParts = files[i].name.split(".")
    
                    if (extensions.indexOf(nameParts[nameParts.length - 1]) !== -1) {
                        // Position in the image list; skipped non-image files must not leave gaps
                        const index = imageList.length

                        images[files[i].name] = {
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
    
                const imageArray = Object.keys(images)
                const imageSet = images // Loads from an earlier selection must not touch a newer image set
                const failed = []
    
                let async = imageArray.length

                if (async === 0) {
                    document.body.style.cursor = "default"
                }

                const imageDone = () => {
                    if (--async !== 0) {
                        return
                    }

                    document.body.style.cursor = "default"

                    if (failed.length > 0) {
                        const more = failed.length > 10 ? `\n...and ${failed.length - 10} more` : ""

                        console.warn(`Could not decode ${failed.length} image(s):`, failed)
                        alert(`Could not load ${failed.length} image(s); they can't be annotated or exported:\n\n` +
                            `${failed.slice(0, 10).join("\n")}${more}`)
                    }

                    const firstLoaded = imageArray.find((name) => typeof images[name].width !== "undefined")

                    if (typeof firstLoaded !== "undefined") {
                        imageListIndex = images[firstLoaded].index
                        imageList.selectedIndex = imageListIndex

                        setCurrentImage(imageInformationContainerID, images[firstLoaded])
                    }

                    if (Object.keys(classes).length > 0) {
                        document.getElementById(bboxesContainerID).disabled = false
                        document.getElementById(restoreBboxesContainerID).disabled = false
                    }
                }
    
                for (let image in images) {
                    const reader = new FileReader()
    
                    reader.addEventListener("load", () => {
                        const imageObject = new Image()
    
                        imageObject.addEventListener("load", (event) => {
                            if (images !== imageSet) {
                                return
                            }

                            images[image].width = event.target.width
                            images[image].height = event.target.height
    
                            imageDone()
                        })

                        imageObject.addEventListener("error", () => {
                            if (images !== imageSet) {
                                return
                            }

                            failed.push(image)

                            imageDone()
                        })
    
                        imageObject.src = reader.result
                    })
    
                    reader.readAsDataURL(images[image].meta)
                }
            }
        })
    }

    const resetImageList = (imageListContainerID) => {
        const imageList = document.getElementById(imageListContainerID)

        imageList.innerHTML = ""

        images = {}
        bboxes = {}
        currentImage = null
        currentImageRequest++
        imageListIndex = 0
    }

    const setCurrentImage = (imageInformationContainerID, imageFile) => {
        if (resetCanvasOnChange === true) {
            resetCanvasPlacement()
        }
    
        const request = ++currentImageRequest
        const reader = new FileReader()
    
        reader.addEventListener("load", () => {
            if (request !== currentImageRequest) {
                return
            }

            const dataUrl = reader.result
            const imageObject = new Image()
    
            imageObject.addEventListener("load", () => {
                if (request !== currentImageRequest) {
                    return
                }

                currentImage = {
                    name: imageFile.meta.name,
                    object: imageObject,
                    width: imageFile.width,
                    height: imageFile.height,
                    scale: 1.0
                }
                refreshCanvas()
            })
    
            imageObject.src = dataUrl
    
            document.getElementById(imageInformationContainerID).innerHTML = `${imageFile.width}x${imageFile.height}, ${formatBytes(imageFile.meta.size)}`
        })
    
        reader.readAsDataURL(imageFile.meta)
    
        if (currentBBox !== null) {
            currentBBox.bbox.marked = false // We unmark via reference
            currentBBox = null // and the we delete
        }
    }

    const listenImageSelect = (imageInformationContainerID, imageListContainerID) => {
        const imageList = document.getElementById(imageListContainerID)

        imageList.addEventListener("change", () => {
            imageListIndex = imageList.selectedIndex

            setCurrentImage(imageInformationContainerID, images[imageList.options[imageListIndex].value])
        })
    }

    const listenClassLoad = (classesListContainerID, classesContainerID, bboxesContainerID, restoreBboxesContainerID) => {
        const classesElement = document.getElementById(classesContainerID)
    
        classesElement.addEventListener("click", () => {
            classesElement.value = null
        })
    
        classesElement.addEventListener("change", (event) => {
            const files = event.target.files
    
            if (files.length > 0) {
                resetClassList(classesListContainerID)
    
                const nameParts = files[0].name.split(".")
                if (nameParts[nameParts.length - 1] === "txt" || nameParts[nameParts.length - 1] === "names") {
                    const reader = new FileReader()
    
                    reader.addEventListener("load", () => {
                        const lines = reader.result
    
                        const rows = lines.split(/[\r\n]+/)
    
                        if (rows.length > 0) {
                            const classList = document.getElementById(classesListContainerID)
    
                            for (let i = 0; i < rows.length; i++) {
                                rows[i] = rows[i].trim()
    
                                if (rows[i] !== "") {
                                    classes[rows[i]] = i
    
                                    const option = document.createElement("option")
    
                                    option.value = i
                                    option.textContent = rows[i]
    
                                    if (i === 0) {
                                        option.selected = true
                                        currentClass = rows[i]
                                    }
    
                                    classList.appendChild(option)
                                }
                            }
    
                            setCurrentClass(classesListContainerID)
    
                            if (Object.keys(images).length > 0) {
                                document.getElementById(bboxesContainerID).disabled = false
                                document.getElementById(restoreBboxesContainerID).disabled = false
                            }
                        }
                    })
    
                    reader.readAsText(files[0])
                }
            }
        })
    }

    const resetClassList = (classesListContainerID) => {
        document.getElementById(classesListContainerID).innerHTML = ""

        classes = {}
        currentClass = null
    }

    const setCurrentClass = (classesListContainerID) => {
        const classList = document.getElementById(classesListContainerID)

        currentClass = classList.options[classList.selectedIndex].text

        if (currentBBox !== null) {
            currentBBox.bbox.marked = false // We unmark via reference
            currentBBox = null // and the we delete
        }
    }

    const listenClassSelect = (classesListContainerID) => {
        const classList = document.getElementById(classesListContainerID)

        classList.addEventListener("change", () => {
            classListIndex = classList.selectedIndex

            setCurrentClass(classesListContainerID)
        })
    }

    const listenBboxLoad = (bboxesContainerID) => {
        const bboxesElement = document.getElementById(bboxesContainerID)
    
        bboxesElement.addEventListener("click", () => {
            bboxesElement.value = null
        })
    
        bboxesElement.addEventListener("change", (event) => {
            const files = event.target.files
    
            if (files.length > 0) {
                resetBboxes()
    
                for (let i = 0; i < files.length; i++) {
                    const reader = new FileReader()
    
                    const extension = files[i].name.split(".").pop()
    
                    reader.addEventListener("load", () => {
                        if (extension === "txt" || extension === "xml" || extension === "json") {
                            storeBbox(files[i].name, reader.result)
                        } else {
                            const zip = new JSZip()
    
                            zip.loadAsync(reader.result)
                                .then((result) => {
                                    for (let filename in result.files) {
                                        result.file(filename).async("string")
                                            .then((text) => {
                                                storeBbox(filename, text)
                                            })
                                    }
                                })
                        }
                        refreshCanvas()
                    })
    
                    if (extension === "txt" || extension === "xml"  || extension === "json") {
                        reader.readAsText(files[i])
                    } else {
                        reader.readAsArrayBuffer(event.target.files[i])
                    }
                }
                
            }
        })
    }

    const resetBboxes = () => {
        bboxes = {}
    }

    const storeBbox = (filename, text) => {
        let image = null
        let bbox = null

        const extension = filename.split(".").pop()

        if (extension === "txt" || extension === "xml") {
            for (let i = 0; i < extensions.length; i++) {
                const imageName = filename.replace(`.${extension}`, `.${extensions[i]}`)

                if (typeof images[imageName] !== "undefined") {
                    image = images[imageName]

                    if (typeof bboxes[imageName] === "undefined") {
                        bboxes[imageName] = {}
                    }

                    bbox = bboxes[imageName]

                    if (extension === "txt") {
                        const rows = text.split(/[\r\n]+/)

                        for (let i = 0; i < rows.length; i++) {
                            const cols = rows[i].split(" ")

                            cols[0] = parseInt(cols[0])

                            for (let className in classes) {
                                if (classes[className] === cols[0]) {
                                    if (typeof bbox[className] === "undefined") {
                                        bbox[className] = []
                                    }

                                    // Reverse engineer actual position and dimensions from yolo format
                                    const width = Math.floor(cols[3] * image.width)
                                    const x = Math.floor(cols[1] * image.width - width * 0.5)
                                    const height = Math.floor(cols[4] * image.height)
                                    const y = Math.floor(cols[2] * image.height - height * 0.5)

                                    bbox[className].push({
                                        x: x,
                                        y: y,
                                        width: width,
                                        height: height,
                                        marked: false,
                                        class: className
                                    })

                                    break
                                }
                            }
                        }
                    } else if (extension === "xml") {
                        const parser = new DOMParser()
                        const xmlDoc = parser.parseFromString(text, "text/xml")

                        const objects = xmlDoc.getElementsByTagName("object")

                        for (let i = 0; i < objects.length; i++) {
                            const objectName = objects[i].getElementsByTagName("name")[0].childNodes[0].nodeValue

                            for (let className in classes) {
                                if (className === objectName) {
                                    if (typeof bbox[className] === "undefined") {
                                        bbox[className] = []
                                    }

                                    const bndBox = objects[i].getElementsByTagName("bndbox")[0]

                                    const bndBoxX = bndBox.getElementsByTagName("xmin")[0].childNodes[0].nodeValue
                                    const bndBoxY = bndBox.getElementsByTagName("ymin")[0].childNodes[0].nodeValue
                                    const bndBoxMaxX = bndBox.getElementsByTagName("xmax")[0].childNodes[0].nodeValue
                                    const bndBoxMaxY = bndBox.getElementsByTagName("ymax")[0].childNodes[0].nodeValue

                                    bbox[className].push({
                                        x: parseInt(bndBoxX),
                                        y: parseInt(bndBoxY),
                                        width: parseInt(bndBoxMaxX) - parseInt(bndBoxX),
                                        height: parseInt(bndBoxMaxY) - parseInt(bndBoxY),
                                        marked: false,
                                        class: className
                                    })

                                    break
                                }
                            }
                        }
                    }
                }
            }
        } else {
            const json = JSON.parse(text)
            let unmatched = 0

            for (let i = 0; i < json.annotations.length; i++) {
                let imageName = null
                let categoryName = null
                // Reset per annotation so an unmatched one can't reuse the previous image's bbox
                image = null
                bbox = null

                for (let j = 0; j < json.images.length; j++) {
                    if (json.annotations[i].image_id === json.images[j].id) {
                        imageName = json.images[j].file_name

                        if (typeof images[imageName] !== "undefined") {
                            image = images[imageName]

                            if (typeof bboxes[imageName] === "undefined") {
                                bboxes[imageName] = {}
                            }

                            bbox = bboxes[imageName]

                            break
                        }
                    }
                }

                if (bbox === null) {
                    unmatched++

                    continue
                }

                for (let j = 0; j < json.categories.length; j++) {
                    if (json.annotations[i].category_id === json.categories[j].id) {
                        categoryName = json.categories[j].name

                        break
                    }
                }

                for (let className in classes) {
                    if (className === categoryName) {
                        if (typeof bbox[className] === "undefined") {
                            bbox[className] = []
                        }

                        const bboxX = json.annotations[i].bbox[0]
                        const bboxY = json.annotations[i].bbox[1]
                        const bboxWidth = json.annotations[i].bbox[2]
                        const bboxHeight = json.annotations[i].bbox[3]

                        bbox[className].push({
                            x: bboxX,
                            y: bboxY,
                            width: bboxWidth,
                            height: bboxHeight,
                            marked: false,
                            class: className
                        })

                        break
                    }
                }
            }

            if (unmatched > 0) {
                console.warn(`${filename}: skipped ${unmatched} annotation(s) whose image is not loaded`)
            }
        }
    }

    // Returns the image for an annotated name, or null (and records the name) if it isn't loaded
    const resolveImage = (imageName, skipped) => {
        const image = images[imageName]

        if (typeof image === "undefined" || typeof image.width === "undefined") {
            skipped.push(imageName)

            return null
        }

        return image
    }

    const reportSkipped = (format, skipped) => {
        if (skipped.length === 0) {
            return
        }

        console.warn(`${format} export: skipped ${skipped.length} annotated image(s) not in the loaded image set:`, skipped)

        const shown = skipped.slice(0, 10).join("\n")
        const more = skipped.length > 10 ? `\n...and ${skipped.length - 10} more` : ""

        alert(`${format} export: skipped ${skipped.length} annotated image(s) that are not in the loaded image set ` +
            `(see console for the full list):\n\n${shown}${more}`)
    }

    // Tallies boxes whose class isn't in the loaded class list (e.g. after loading another classes file)
    const isUnknownClass = (className, classBboxes, unknownClasses) => {
        if (typeof classes[className] !== "undefined") {
            return false
        }

        if (classBboxes.length > 0) {
            unknownClasses[className] = (unknownClasses[className] || 0) + classBboxes.length
        }

        return true
    }

    const reportUnknownClasses = (format, unknownClasses) => {
        const names = Object.keys(unknownClasses)

        if (names.length === 0) {
            return
        }

        const list = names.map((name) => `${name} (${unknownClasses[name]} box(es))`).join("\n")

        console.warn(`${format} export: skipped boxes with classes not in the loaded class list:`, unknownClasses)

        alert(`${format} export: skipped boxes whose class is not in the loaded class list:\n\n${list}`)
    }

    const escapeXml = (value) => String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")

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

    const listenBboxSave = (saveBBoxesContainerID) => {
        document.getElementById(saveBBoxesContainerID).addEventListener("click", () => {
            const zip = new JSZip()
            const skipped = []
            const unknownClasses = {}

            for (let imageName in bboxes) {
                const image = resolveImage(imageName, skipped)

                if (image === null) {
                    continue
                }

                const name = imageName.split(".")

                name[name.length - 1] = "txt"

                const result = []

                for (let className in bboxes[imageName]) {
                    if (isUnknownClass(className, bboxes[imageName][className], unknownClasses)) {
                        continue
                    }

                    for (let i = 0; i < bboxes[imageName][className].length; i++) {
                        const bbox = clampBbox(bboxes[imageName][className][i], image)

                        if (bbox === null) {
                            continue
                        }

                        // Prepare data for yolo format
                        const x = (bbox.x + bbox.width / 2) / image.width
                        const y = (bbox.y + bbox.height / 2) / image.height
                        const width = bbox.width / image.width
                        const height = bbox.height / image.height

                        result.push(`${classes[className]} ${x} ${y} ${width} ${height}`)
                    }
                }

                zip.file(name.join("."), result.join("\n"))
            }

            reportSkipped("YOLO", skipped)
            reportUnknownClasses("YOLO", unknownClasses)

            zip.generateAsync({type: "blob"})
                .then((blob) => {
                    saveAs(blob, "bboxes_yolo.zip")
                })
        })
    }

    const listenBboxVocSave = (saveBBoxesVOCContainerID, vocFolderContainerID) => {
        document.getElementById(saveBBoxesVOCContainerID).addEventListener("click", () => {
            const folderPath = document.getElementById(vocFolderContainerID).value

            const zip = new JSZip()
            const skipped = []

            for (let imageName in bboxes) {
                const image = resolveImage(imageName, skipped)

                if (image === null) {
                    continue
                }

                const name = imageName.split(".")

                name[name.length - 1] = "xml"

                const result = [
                    "<?xml version=\"1.0\"?>",
                    "<annotation>",
                    `<folder>${escapeXml(folderPath)}</folder>`,
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
                    "<segmented>0</segmented>"
                ]

                for (let className in bboxes[imageName]) {
                    for (let i = 0; i < bboxes[imageName][className].length; i++) {
                        const bbox = clampBbox(bboxes[imageName][className][i], image)

                        if (bbox === null) {
                            continue
                        }

                        result.push("<object>")
                        result.push(`<name>${escapeXml(className)}</name>`)
                        result.push("<pose>Unspecified</pose>")
                        result.push("<truncated>0</truncated>")
                        result.push("<occluded>0</occluded>")
                        result.push("<difficult>0</difficult>")

                        result.push("<bndbox>")
                        result.push(`<xmin>${Math.round(bbox.x)}</xmin>`)
                        result.push(`<ymin>${Math.round(bbox.y)}</ymin>`)
                        result.push(`<xmax>${Math.round(bbox.x + bbox.width)}</xmax>`)
                        result.push(`<ymax>${Math.round(bbox.y + bbox.height)}</ymax>`)
                        result.push("</bndbox>")

                        result.push("</object>")
                    }
                }

                result.push("</annotation>")

                if (result.length > 15) {
                    zip.file(name.join("."), result.join("\n"))
                }
            }

            reportSkipped("VOC", skipped)

            zip.generateAsync({type: "blob"})
                .then((blob) => {
                    saveAs(blob, "bboxes_voc.zip")
                })
        })
    }

    const listenBboxCocoSave = (saveBBoxesCOCOContainerID) => {
        document.getElementById(saveBBoxesCOCOContainerID).addEventListener("click", () => {
            const zip = new JSZip()

            const result = {
                images: [],
                type: "instances",
                annotations: [],
                categories: []
            }

            for (let className in classes) {
                result.categories.push({
                    supercategory: "none",
                    id: classes[className] + 1,
                    name: className
                })
            }

            for (let imageName in images) {
                result.images.push({
                    id: images[imageName].index + 1,
                    file_name: imageName, //eslint-disable-line camelcase
                    width: images[imageName].width,
                    height: images[imageName].height
                })
            }

            let id = 0
            const skipped = []
            const unknownClasses = {}

            for (let imageName in bboxes) {
                const image = resolveImage(imageName, skipped)

                if (image === null) {
                    continue
                }

                for (let className in bboxes[imageName]) {
                    if (isUnknownClass(className, bboxes[imageName][className], unknownClasses)) {
                        continue
                    }

                    for (let i = 0; i < bboxes[imageName][className].length; i++) {
                        const bbox = clampBbox(bboxes[imageName][className][i], image)

                        if (bbox === null) {
                            continue
                        }

                        const segmentation = [[
                            bbox.x, bbox.y,
                            bbox.x, bbox.y + bbox.height,
                            bbox.x + bbox.width, bbox.y + bbox.height,
                            bbox.x + bbox.width, bbox.y
                        ]]

                        result.annotations.push({
                            segmentation: segmentation,
                            area: bbox.width * bbox.height,
                            iscrowd: 0,
                            ignore: 0,
                            image_id: image.index + 1, //eslint-disable-line camelcase
                            bbox: [bbox.x, bbox.y, bbox.width, bbox.height],
                            category_id: classes[className] + 1, //eslint-disable-line camelcase
                            id: ++id
                        })
                    }
                }
            }

            zip.file("coco.json", JSON.stringify(result))

            reportSkipped("COCO", skipped)
            reportUnknownClasses("COCO", unknownClasses)

            zip.generateAsync({type: "blob"})
                .then((blob) => {
                    saveAs(blob, "bboxes_coco.zip")
                })
        })
    }

    const listenBboxRestore = (restoreBboxesContainerID) => {
        document.getElementById(restoreBboxesContainerID).addEventListener("click", () => {
            const item = localStorage.getItem("bboxes")

            if (item) {
                bboxes = JSON.parse(item)
            }
        })
    }

    const listenKeyboard = (imageInformationContainerID, imageListContainerID, classListContainerID) => {
        const imageList = document.getElementById(imageListContainerID)
        const classList = document.getElementById(classListContainerID)
    
        document.addEventListener("keydown", (event) => {
            const key = event.keyCode || event.charCode
            // Delete
            if (key === 46 || (key === 8 && event.metaKey === true)) {
                if (currentBBox !== null) {
                    const deleted = bboxes[currentImage.name][currentBBox.bbox.class].splice(currentBBox.index, 1)
                    currentBBox = null
                    document.body.style.cursor = "default"
                    canvas.remove(canvas.getActiveObject())
                }
                event.preventDefault()
            }
            // Arrow right
            if (key === 37) {
                if (imageList.length > 1) {
                    imageList.options[imageListIndex].selected = false
                    if (imageListIndex === 0) {
                        imageListIndex = imageList.length - 1
                    } else {
                        imageListIndex--
                    }
                    imageList.options[imageListIndex].selected = true
                    imageList.selectedIndex = imageListIndex
                    setCurrentImage(imageInformationContainerID, images[imageList.options[imageListIndex].value])
                    document.body.style.cursor = "default"
                }
                event.preventDefault()
            }
            // Arrow left
            if (key === 39) {
                if (imageList.length > 1) {
                    imageList.options[imageListIndex].selected = false
                    if (imageListIndex === imageList.length - 1) {
                        imageListIndex = 0
                    } else {
                        imageListIndex++
                    }
                    imageList.options[imageListIndex].selected = true
                    imageList.selectedIndex = imageListIndex
                    setCurrentImage(imageInformationContainerID, images[imageList.options[imageListIndex].value])
                    document.body.style.cursor = "default"
                }
                event.preventDefault()
            }
            // Arrow up
            if (key === 38) {
                if (classList.length > 1) {
                    classList.options[classListIndex].selected = false
                    if (classListIndex === 0) {
                        classListIndex = classList.length - 1
                    } else {
                        classListIndex--
                    }
                    classList.options[classListIndex].selected = true
                    classList.selectedIndex = classListIndex
                    setCurrentClass(classListContainerID)
                }
                event.preventDefault()
            }
            // Arrow down
            if (key === 40) {
                if (classList.length > 1) {
                    classList.options[classListIndex].selected = false
                    if (classListIndex === classList.length - 1) {
                        classListIndex = 0
                    } else {
                        classListIndex++
                    }
                    classList.options[classListIndex].selected = true
                    classList.selectedIndex = classListIndex
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

            for (let imageName in images) {
                if (imageName.indexOf(value) !== -1) {
                    imageListIndex = images[imageName].index
                    document.getElementById(imageListContainerID).selectedIndex = imageListIndex

                    setCurrentImage(imageInformationContainerID, images[imageName])

                    break
                }
            }
        })
    }

    const listenImageCrop = (cropImagesContainerID) => {
        document.getElementById(cropImagesContainerID).addEventListener("click", () => {
            const zip = new JSZip()
            const skipped = []
            const crops = []

            for (let imageName in bboxes) {
                const image = resolveImage(imageName, skipped)

                if (image === null) {
                    continue
                }

                for (let className in bboxes[imageName]) {
                    for (let i = 0; i < bboxes[imageName][className].length; i++) {
                        const bbox = clampBbox(bboxes[imageName][className][i], image)

                        if (bbox !== null) {
                            crops.push({imageName, image, className, i, bbox})
                        }
                    }
                }
            }

            reportSkipped("Crop", skipped)

            let pending = crops.length

            if (pending === 0) {
                return
            }

            document.body.style.cursor = "wait" // Mark as busy

            const cropDone = () => {
                if (--pending === 0) {
                    document.body.style.cursor = "default"

                    zip.generateAsync({type: "blob"})
                        .then((blob) => {
                            saveAs(blob, "crops.zip")
                        })
                }
            }

            crops.forEach(({imageName, image, className, i, bbox}) => {
                const reader = new FileReader()

                reader.addEventListener("load", () => {
                    const dataUrl = reader.result
                    const imageObject = new Image()

                    imageObject.addEventListener("error", () => {
                        console.warn(`Crop: could not decode ${imageName}`)
                        cropDone()
                    })

                    imageObject.addEventListener("load", () => {
                        const temporaryCanvas = document.createElement("canvas")

                        temporaryCanvas.style.display = "none"
                        temporaryCanvas.width = bbox.width
                        temporaryCanvas.height = bbox.height

                        temporaryCanvas.getContext("2d").drawImage(
                            imageObject,
                            bbox.x,
                            bbox.y,
                            bbox.width,
                            bbox.height,
                            0,
                            0,
                            bbox.width,
                            bbox.height
                        )

                        temporaryCanvas.toBlob((blob) => {
                            const imageNameParts = imageName.split(".")

                            imageNameParts[imageNameParts.length - 2] += `-${className}-${i}`

                            if (blob !== null) {
                                zip.file(imageNameParts.join("."), blob)
                            } else {
                                console.warn(`Crop: empty crop ${imageNameParts.join(".")} skipped`)
                            }

                            cropDone()
                        }, image.meta.type)
                    })

                    imageObject.src = dataUrl
                })

                reader.readAsDataURL(image.meta)
            })
        })
    }
})()
