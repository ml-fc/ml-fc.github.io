const VISION_MODULE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";
const VISION_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const FACE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

let detectorPromise;

async function loadDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FaceDetector, FilesetResolver } = await import(VISION_MODULE_URL);
      const vision = await FilesetResolver.forVisionTasks(VISION_WASM_URL);
      return FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL },
        runningMode: "IMAGE",
        minDetectionConfidence: .55,
        minSuppressionThreshold: .3,
      });
    })().catch(error => {
      detectorPromise = null;
      throw error;
    });
  }
  return detectorPromise;
}

export async function checkFaceCrop(canvas) {
  const detector = await loadDetector();
  const detections = detector.detect(canvas)?.detections || [];
  if (!detections.length) {
    return { quality: "warning", message: "No face detected. Try a clearer photo or move your face into the circle." };
  }
  if (detections.length > 1) {
    return { quality: "warning", message: "More than one face detected. Crop closely around your face only." };
  }

  const box = detections[0]?.boundingBox || {};
  const width = Number(box.width || 0) / canvas.width;
  const height = Number(box.height || 0) / canvas.height;
  const centreX = (Number(box.originX || 0) + Number(box.width || 0) / 2) / canvas.width;
  const centreY = (Number(box.originY || 0) + Number(box.height || 0) / 2) / canvas.height;
  const distanceFromCentre = Math.hypot(centreX - .5, centreY - .5);

  if (width < .34 || height < .34) {
    return { quality: "warning", message: "A face was found, but it is too small. Zoom in so it fills more of the circle." };
  }
  if (width > .92 || height > .92) {
    return { quality: "warning", message: "Your face is very close to the edge. Zoom out slightly to keep it inside the circle." };
  }
  if (distanceFromCentre > .2) {
    return { quality: "warning", message: "A face was found. Move it closer to the centre of the circle." };
  }
  return { quality: "good", message: "Face detected — this crop should look good on team sheets." };
}
