import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, CameraOff, RotateCcw, Flashlight, FlashlightOff } from 'lucide-react';
import jsQR from 'jsqr';

// Built-in QR Code detection using ZXing library via CDN
const detectQRCode = async (canvas) => {
  try {
      return jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "dontInvert", // Try different inversion attempts for better detection
  });
    
    // Fallback: Basic pattern detection for demo purposes
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Look for QR code-like patterns (simplified detection)
    let blackPixels = 0;
    let whitePixels = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r + g + b) / 3;
      
      if (brightness < 128) {
        blackPixels++;
      } else {
        whitePixels++;
      }
    }
    
    // Very basic check - if there's a good mix of black and white pixels
    // In a real QR scanner, this would be much more sophisticated
    const ratio = blackPixels / (blackPixels + whitePixels);
    if (ratio > 0.2 && ratio < 0.8) {
      // Simulate finding a QR code for demo
      return { data: `Demo QR Code detected at ${new Date().toLocaleTimeString()}` };
    }
    
    return null;
  } catch (error) {
    console.error('QR detection error:', error);
    return null;
  }
};

const QRScanner = () => {
  const [isScanning, setIsScanning] = useState(false);
  const [scannedData, setScannedData] = useState('');
  const [error, setError] = useState('');
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [facingMode, setFacingMode] = useState('environment'); // 'user' for front, 'environment' for back
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [isLibraryLoaded, setIsLibraryLoaded] = useState(false);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Load ZXing library
  useEffect(() => {
    const loadZXing = () => {
      if (window.ZXing) {
        setIsLibraryLoaded(true);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/zxing-library/0.18.6/index.min.js';
      script.onload = () => {
        setIsLibraryLoaded(true);
      };
      script.onerror = () => {
        console.warn('Failed to load ZXing library, using fallback detection');
        setIsLibraryLoaded(true);
      };
      document.head.appendChild(script);
    };

    loadZXing();
  }, []);

  // Get available cameras
  const getCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      setDevices(videoDevices);
      
      // Prefer back camera if available
      const backCamera = videoDevices.find(device => 
        device.label.toLowerCase().includes('back') || 
        device.label.toLowerCase().includes('rear')
      );
      
      if (backCamera) {
        setSelectedDeviceId(backCamera.deviceId);
      } else if (videoDevices.length > 0) {
        setSelectedDeviceId(videoDevices[0].deviceId);
      }
    } catch (err) {
      setError('Failed to get camera devices: ' + err.message);
    }
  }, []);

  // Start camera stream
  const startCamera = useCallback(async () => {
    try {
      setError('');
      
      // Stop existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const constraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          ...(selectedDeviceId && { deviceId: { exact: selectedDeviceId } })
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        // Check for torch support
        const videoTrack = stream.getVideoTracks()[0];
        const capabilities = videoTrack.getCapabilities();
        setTorchSupported(!!capabilities.torch);
      }

      setIsScanning(true);
    } catch (err) {
      setError('Camera access denied or not available: ' + err.message);
      setIsScanning(false);
    }
  }, [facingMode, selectedDeviceId]);

  // Stop camera stream
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    setIsScanning(false);
    setTorchEnabled(false);
  }, []);

  // Toggle torch/flashlight
  const toggleTorch = useCallback(async () => {
    if (!streamRef.current || !torchSupported) return;
    
    try {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      await videoTrack.applyConstraints({
        advanced: [{ torch: !torchEnabled }]
      });
      setTorchEnabled(!torchEnabled);
    } catch (err) {
      console.error('Failed to toggle torch:', err);
    }
  }, [torchEnabled, torchSupported]);

  // Scan QR code from video frame
  const scanFrame = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !isScanning) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      // Set canvas size to video size
      canvas.height = video.videoHeight;
      canvas.width = video.videoWidth;

      // Draw video frame to canvas
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Detect QR code
      const code = await detectQRCode(canvas);
      
      if (code && code.data) {
        setScannedData(code.data);
        setIsScanning(false);
        stopCamera();
        return; // Stop scanning after successful detection
      }
    }

    // Continue scanning
    animationFrameRef.current = requestAnimationFrame(scanFrame);
  }, [isScanning, stopCamera]);

  // Start scanning frames when camera starts
  useEffect(() => {
    if (isScanning && videoRef.current) {
      const video = videoRef.current;
      
      const handleLoadedMetadata = () => {
        scanFrame();
      };
      
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      
      return () => {
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }
  }, [isScanning, scanFrame]);

  // Get cameras on mount
  useEffect(() => {
    getCameras();
  }, [getCameras]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const switchCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  const resetScanner = () => {
    setScannedData('');
    setError('');
  };

  return (
    <div className="max-w-md mx-auto p-4 bg-white rounded-lg shadow-lg">
      <div className="text-center mb-4">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">QR Code Scanner</h1>
        
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        
        {scannedData && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
            <h3 className="font-bold">Scanned Data:</h3>
            <p className="break-all">{scannedData}</p>
          </div>
        )}
      </div>

      <div className="relative">
        {isScanning ? (
          <div className="relative">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-64 bg-black rounded-lg object-cover"
            />
            
            {/* Scanning overlay */}
            <div className="absolute inset-0 border-2 border-blue-500 rounded-lg">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-500"></div>
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-500"></div>
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-500"></div>
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-500"></div>
            </div>
            
            {/* Control buttons */}
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-2">
              <button
                onClick={switchCamera}
                className="bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-70"
                title="Switch Camera"
              >
                <RotateCcw size={20} />
              </button>
              
              {torchSupported && (
                <button
                  onClick={toggleTorch}
                  className="bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-70"
                  title="Toggle Flashlight"
                >
                  {torchEnabled ? <FlashlightOff size={20} /> : <Flashlight size={20} />}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="w-full h-64 bg-gray-100 rounded-lg flex items-center justify-center">
            <div className="text-center">
              <Camera size={48} className="text-gray-400 mx-auto mb-2" />
              <p className="text-gray-600">Camera not active</p>
            </div>
          </div>
        )}
      </div>

      {/* Camera selection */}
      {devices.length > 1 && (
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Select Camera:
          </label>
          <select
            value={selectedDeviceId}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md"
            disabled={isScanning}
          >
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${device.deviceId.slice(0, 8)}...`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Control buttons */}
      <div className="mt-6 flex space-x-3">
        {!isScanning ? (
          <button
            onClick={startCamera}
            disabled={!isLibraryLoaded}
            className={`flex-1 font-bold py-3 px-4 rounded-lg flex items-center justify-center ${
              isLibraryLoaded 
                ? 'bg-blue-500 hover:bg-blue-600 text-white' 
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            <Camera className="mr-2" size={20} />
            {isLibraryLoaded ? 'Start Scanning' : 'Loading...'}
          </button>
        ) : (
          <button
            onClick={stopCamera}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center"
          >
            <CameraOff className="mr-2" size={20} />
            Stop Scanning
          </button>
        )}
        
        {(scannedData || error) && (
          <button
            onClick={resetScanner}
            className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-lg"
          >
            Reset
          </button>
        )}
      </div>

      {/* Hidden canvas for image processing */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default QRScanner;