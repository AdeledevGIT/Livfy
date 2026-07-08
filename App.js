document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const video = document.getElementById('video');
    const outputCanvas = document.getElementById('outputCanvas');
    const outputCtx = outputCanvas.getContext('2d');
    const startCameraBtn = document.getElementById('startCamera');
    const toggleFaceSwapBtn = document.getElementById('toggleFaceSwap');
    const toggleBodySegmentationBtn = document.getElementById('toggleBodySegmentation');
    const takePictureBtn = document.getElementById('takePicture');
    const imageUpload = document.getElementById('imageUpload');
    const uploadedImagePreview = document.getElementById('uploadedImagePreview');
    const uploadedImg = document.getElementById('uploadedImg');
    const resultSection = document.getElementById('resultSection');
    const resultImage = document.getElementById('resultImage');
    
    // State variables
    let camera = null;
    let faceDetection = null;
    let selfieSegmentation = null;
    let isFaceSwapActive = false;
    let isBodySegmentationActive = false;
    let backgroundImage = null;
    let backgroundImageData = null;
    
    // Initialize face detection
    function initializeFaceDetection() {
        faceDetection = new FaceDetection({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`;
            }
        });
        
        faceDetection.setOptions({
            model: 'short',
            minDetectionConfidence: 0.5
        });
        
        faceDetection.onResults(onFaceDetectionResults);
    }
    
    // Initialize selfie segmentation for body detection
    function initializeSelfieSegmentation() {
        selfieSegmentation = new SelfieSegmentation({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
            }
        });
        
        selfieSegmentation.setOptions({
            modelSelection: 1, // 0 for general, 1 for portrait
        });
        
        selfieSegmentation.onResults(onSelfieSegmentationResults);
    }
    
    // Handle face detection results
    function onFaceDetectionResults(results) {
        // Set canvas dimensions to match video
        outputCanvas.width = video.videoWidth;
        outputCanvas.height = video.videoHeight;
        
        // Clear canvas
        outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
        
        if (backgroundImageData) {
            // Draw the uploaded background image
            outputCtx.drawImage(backgroundImageData, 0, 0, outputCanvas.width, outputCanvas.height);
        }
        
        if (isFaceSwapActive && results.detections.length > 0) {
            // Process each detected face
            for (const detection of results.detections) {
                // Draw the face from the video onto the canvas
                drawFaceSwap(detection);
            }
        } else {
            // If face swap is not active, just draw the video
            outputCtx.drawImage(video, 0, 0, outputCanvas.width, outputCanvas.height);
        }
    }
    
    // Handle selfie segmentation results
    function onSelfieSegmentationResults(results) {
        // Set canvas dimensions to match video
        outputCanvas.width = video.videoWidth;
        outputCanvas.height = video.videoHeight;
        
        // Clear canvas
        outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
        
        if (backgroundImageData) {
            // Draw the uploaded background image
            outputCtx.drawImage(backgroundImageData, 0, 0, outputCanvas.width, outputCanvas.height);
        }
        
        if (isBodySegmentationActive && results.segmentationMask) {
            // Create a temporary canvas for the person
            const personCanvas = document.createElement('canvas');
            personCanvas.width = outputCanvas.width;
            personCanvas.height = outputCanvas.height;
            const personCtx = personCanvas.getContext('2d');
            
            // Save the current context state
            personCtx.save();
            
            // Draw the segmentation mask
            personCtx.globalCompositeOperation = 'copy';
            personCtx.drawImage(results.segmentationMask, 0, 0, outputCanvas.width, outputCanvas.height);
            
            // Apply the video to the mask
            personCtx.globalCompositeOperation = 'source-in';
            personCtx.drawImage(results.image, 0, 0, outputCanvas.width, outputCanvas.height);
            
            // Restore context state
            personCtx.restore();
            
            // Draw the person on top of the background
            outputCtx.drawImage(personCanvas, 0, 0);
        }
    }
    
    // Draw face swap
    function drawFaceSwap(detection) {
        // Get bounding box of the detected face
        const bbox = detection.boundingBox;
        
        // Calculate face dimensions
        const x = bbox.xCenter * outputCanvas.width;
        const y = bbox.yCenter * outputCanvas.height;
        const width = bbox.width * outputCanvas.width;
        const height = bbox.height * outputCanvas.height;
        
        // Extract face from video
        const faceCanvas = document.createElement('canvas');
        const faceCtx = faceCanvas.getContext('2d');
        faceCanvas.width = width;
        faceCanvas.height = height;
        
        // Draw the face from video to the temporary canvas
        faceCtx.drawImage(
            video,
            (x - width/2), (y - height/2), width, height,
            0, 0, width, height
        );
        
        // Apply face to the background image
        outputCtx.drawImage(
            faceCanvas,
            (x - width/2), (y - height/2), width, height
        );
    }
    
    // Start camera with both face and body detection support
    async function startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 }
            });
            
            video.srcObject = stream;
            
            camera = new Camera(video, {
                onFrame: async () => {
                    if (isBodySegmentationActive && selfieSegmentation) {
                        await selfieSegmentation.send({ image: video });
                    } else if (faceDetection) {
                        await faceDetection.send({ image: video });
                    }
                },
                width: 640,
                height: 480
            });
            
            camera.start();
            startCameraBtn.textContent = 'Stop Camera';
            startCameraBtn.onclick = stopCamera;
        } catch (error) {
            console.error('Error accessing camera:', error);
            alert('Could not access camera. Please check permissions.');
        }
    }
    
    // Stop camera
    function stopCamera() {
        if (camera) {
            camera.stop();
            video.srcObject.getTracks().forEach(track => track.stop());
            startCameraBtn.textContent = 'Start Camera';
            startCameraBtn.onclick = startCamera;
        }
    }
    
    // Toggle face swap
    function toggleFaceSwap() {
        isFaceSwapActive = !isFaceSwapActive;
        isBodySegmentationActive = false; // Disable body segmentation when face swap is active
        toggleFaceSwapBtn.textContent = isFaceSwapActive ? 'Disable Face Swap' : 'Enable Face Swap';
        toggleBodySegmentationBtn.textContent = 'Enable Body Segmentation';
    }
    
    // Toggle body segmentation
    function toggleBodySegmentation() {
        isBodySegmentationActive = !isBodySegmentationActive;
        isFaceSwapActive = false; // Disable face swap when body segmentation is active
        toggleBodySegmentationBtn.textContent = isBodySegmentationActive ? 'Disable Body Segmentation' : 'Enable Body Segmentation';
        toggleFaceSwapBtn.textContent = 'Enable Face Swap';
    }
    
    // Take picture
    function takePicture() {
        resultImage.src = outputCanvas.toDataURL('image/png');
        resultSection.classList.remove('hidden');
    }
    
    // Handle image upload
    function handleImageUpload(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            
            reader.onload = function(event) {
                uploadedImg.src = event.target.result;
                uploadedImagePreview.classList.remove('hidden');
                
                // Create image object for processing
                backgroundImage = new Image();
                backgroundImage.onload = function() {
                    // Create a canvas to store the background image data
                    const bgCanvas = document.createElement('canvas');
                    const bgCtx = bgCanvas.getContext('2d');
                    
                    // Set canvas dimensions to match video
                    bgCanvas.width = 640;
                    bgCanvas.height = 480;
                    
                    // Draw the image to the canvas (maintaining aspect ratio)
                    const scale = Math.min(bgCanvas.width / backgroundImage.width, bgCanvas.height / backgroundImage.height);
                    const x = (bgCanvas.width - backgroundImage.width * scale) / 2;
                    const y = (bgCanvas.height - backgroundImage.height * scale) / 2;
                    
                    bgCtx.drawImage(backgroundImage, x, y, backgroundImage.width * scale, backgroundImage.height * scale);
                    
                    // Store the image data for later use
                    backgroundImageData = bgCanvas;
                };
                backgroundImage.src = event.target.result;
            };
            
            reader.readAsDataURL(file);
        }
    }
    
    // Event listeners
    startCameraBtn.addEventListener('click', startCamera);
    toggleFaceSwapBtn.addEventListener('click', toggleFaceSwap);
    toggleBodySegmentationBtn.addEventListener('click', toggleBodySegmentation);
    takePictureBtn.addEventListener('click', takePicture);
    imageUpload.addEventListener('change', handleImageUpload);
    
    // Initialize both detection methods when page loads
    initializeFaceDetection();
    initializeSelfieSegmentation();
});
