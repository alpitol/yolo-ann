const formatBytes = (bytes, decimals) => {
    if (bytes === 0) {
        return "0 Bytes"
    }

    const k = 1024
    const dm = decimals || 2
    const sizes = ["Bytes", "KB", "MB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i]
}

const crossFromRectangle = (x, y, width, height, paddingPercentage = 1) => {
    const centerX = x + width / 2
    const centerY = y + height / 2

    const offsetY = (height - (height * paddingPercentage)) / 2
    const offsetX = (width - (width * paddingPercentage)) / 2

    return { vertical: [centerX, (centerY - offsetY), centerX, (centerY + offsetY)], horizontal: [(centerX - offsetX), centerY, (centerX + offsetX), centerY] }
}
// Promise wrappers for file loading, so callers can use async/await
const readFile = (file, method) => new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.addEventListener("load", () => resolve(reader.result))
    reader.addEventListener("error", () => reject(reader.error || new Error(`Could not read ${file.name}`)))
    reader[method](file)
})

const readText = (file) => readFile(file, "readAsText")

const readArrayBuffer = (file) => readFile(file, "readAsArrayBuffer")

// Decodes an image file into an <img>; rejects if the browser can't decode it
const loadImage = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()

    image.addEventListener("load", () => {
        URL.revokeObjectURL(url)
        resolve(image)
    })
    image.addEventListener("error", () => {
        URL.revokeObjectURL(url)
        reject(new Error(`Could not decode ${file.name}`))
    })
    image.src = url
})

const canvasToBlob = (canvas, type) => new Promise((resolve) => canvas.toBlob(resolve, type))
