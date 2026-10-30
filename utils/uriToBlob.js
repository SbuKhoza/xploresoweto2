// Turns a local file URI (e.g. from expo-image-picker) into a Blob that the
// Firebase Storage SDK can upload.
//
// Why not `(await fetch(uri)).blob()`? Expo replaces the global fetch, and its
// Response.blob() calls a native function that is missing when the installed app
// binary (Expo Go / dev build) is older than the JS — which throws
// "undefined is not a function". React Native's own XMLHttpRequest creates the
// blob natively and works everywhere, including file:// URIs.
export const uriToBlob = (uri) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.onload = () => {
      if (xhr.response) resolve(xhr.response)
      else reject(new Error("Could not read the selected image"))
    }
    xhr.onerror = () => reject(new Error("Could not read the selected image"))
    xhr.responseType = "blob"
    xhr.open("GET", uri, true)
    xhr.send(null)
  })