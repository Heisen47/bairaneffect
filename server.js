const express = require('express');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const FormData = require('form-data');

const app = express();
app.use(express.json({ limit: '100mb' }));

const multer = require('multer');
const uploadTempDir = path.join(__dirname, 'temp-uploads');
if (!fs.existsSync(uploadTempDir)) fs.mkdirSync(uploadTempDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadTempDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});
const upload = multer({ storage });

const FFMPEG = 'ffmpeg';
const TEMP_BASE_DIR = 'temp-requests';

if (!fs.existsSync(TEMP_BASE_DIR)) fs.mkdirSync(TEMP_BASE_DIR, { recursive: true });

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

async function uploadToStoreFile(filePath, userId) {
 const url = process.env.STORE_API_URL;

  if (!url) {
    console.warn('STORE_API_URL not configured; skipping external upload and using local server output path.');
    const stats = fs.statSync(filePath);
    return {
      fileUrl: `/download/${path.basename(filePath)}`,
      fileId: null,
      originalFilename: path.basename(filePath),
      fileSize: stats.size
    };
  }

  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('userid', userId);

    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname,
      method: 'POST',
      headers: form.getHeaders()
    };

    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        } else {
          reject(new Error(`Upload failed with status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    form.pipe(req);
  });
}

function extractZip(zipPath, destDir) {
  console.log(`Extracting zip: ${zipPath}`);
  execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
  
  const files = fs.readdirSync(destDir);
  console.log(`Extracted ${files.length} files`);
}

function runStep(stepNum, workDir) {
  return new Promise((resolve, reject) => {
    let scriptName;
    if (stepNum === 1) scriptName = 'step1-extract-last-frame.js';
    else if (stepNum === 2) scriptName = 'step2-remove-background.js';
    else if (stepNum === 3) scriptName = 'step3-add-borders.js';
    else if (stepNum === 4) scriptName = 'step4-compose-video.js';
    
    console.log(`Running step ${stepNum}: ${scriptName}`);
    
    const proc = spawn('node', [scriptName, workDir], { 
      cwd: __dirname,
      stdio: 'inherit' 
    });
    
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Step ${stepNum} failed with code ${code}`));
    });
  });
}

async function processVideo(videoPath, isUrl = false, zipPath = null, zipUrl = false, userId = null, imageUrls = null) {
  const requestId = generateRequestId();
  const effectiveUserId = userId || requestId;
  const workDir = path.join(TEMP_BASE_DIR, requestId);
  const imagesDir = path.join(workDir, 'middle-images');
  const outputDir = path.join(workDir, 'output');
  
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`Created work directory for request: ${requestId}`);
  
  try {
    const tempZip = path.join(workDir, 'input-images.zip');
    const middleSlideshow = path.join(outputDir, 'middle-slideshow.mp4');
    
    if (zipPath) {
      if (zipUrl) {
        console.log(`Downloading zip from: ${zipPath}`);
        await downloadFile(zipPath, tempZip);
        zipPath = tempZip;
      }
      
      if (!fs.existsSync(zipPath)) {
        throw new Error(`Zip file not found: ${zipPath}`);
      }
      
      console.log(`Extracting images from zip: ${zipPath}`);
      extractZip(zipPath, imagesDir);
      
      if (zipUrl && fs.existsSync(tempZip)) {
        fs.unlinkSync(tempZip);
      }
      
      console.log('Creating slideshow from images...');
      await new Promise((resolve, reject) => {
        const proc = spawn('node', ['create-middle-slideshow.js', imagesDir, middleSlideshow], { 
          cwd: __dirname,
          stdio: 'inherit' 
        });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Slideshow creation failed with code ${code}`));
        });
      });
    } else if (imageUrls && imageUrls.length > 0) {
      console.log(`Downloading ${imageUrls.length} images...`);
      for (let i = 0; i < imageUrls.length; i++) {
        const imageUrl = imageUrls[i];
        const ext = path.extname(new URL(imageUrl).pathname).split('?')[0] || '.jpg';
        const destPath = path.join(imagesDir, `image_${String(i).padStart(3, '0')}${ext}`);
        console.log(`Downloading image ${i + 1}/${imageUrls.length}: ${imageUrl}`);
        await downloadFile(imageUrl, destPath);
      }
      
      console.log('Creating slideshow from images...');
      await new Promise((resolve, reject) => {
        const proc = spawn('node', ['create-middle-slideshow.js', imagesDir, middleSlideshow], { 
          cwd: __dirname,
          stdio: 'inherit' 
        });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Slideshow creation failed with code ${code}`));
        });
      });
    }
    
    const tempVideo = path.join(workDir, 'input-video.mp4');
    
    if (isUrl) {
      console.log(`Downloading video from: ${videoPath}`);
      await downloadFile(videoPath, tempVideo);
      videoPath = tempVideo;
    } else {
      if (!fs.existsSync(videoPath)) {
        throw new Error(`Video file not found: ${videoPath}`);
      }
    }

    console.log(`Processing: ${videoPath}`);
    
    const ext = path.extname(videoPath).toLowerCase();
    if (!['.mp4', '.mov', '.avi'].includes(ext)) {
      throw new Error('Unsupported video format. Use MP4, MOV, or AVI.');
    }

    const mainVideo = path.join(workDir, 'main-video.MP4');
    
    // Convert video to MP4 format (handles MOV and other formats)
    console.log(`Converting to MP4: ${videoPath}`);
    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-i', videoPath,
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        '-y',
        mainVideo
      ], { stdio: 'inherit' });
      proc.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ Converted to MP4: ${mainVideo}`);
          resolve();
        } else {
          reject(new Error(`Video conversion failed with code ${code}`));
        }
      });
    });

    await runStep(1, workDir);
    await runStep(2, workDir);
    await runStep(3, workDir);
    await runStep(4, workDir);

    const finalVideo = path.join(outputDir, 'final-video.mp4');

    const persistentOutputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(persistentOutputDir)) {
      fs.mkdirSync(persistentOutputDir, { recursive: true });
    }

    const finalFilename = `${requestId}-final-video.mp4`;
    const persistentFinalVideo = path.join(persistentOutputDir, finalFilename);
    fs.copyFileSync(finalVideo, persistentFinalVideo);

    console.log('Uploading final video to store-file...');
    const uploadResult = await uploadToStoreFile(persistentFinalVideo, effectiveUserId);
    console.log(`Upload complete: ${uploadResult.fileUrl}`);

    if (isUrl && fs.existsSync(tempVideo)) {
      fs.unlinkSync(tempVideo);
    }

    fs.rmSync(workDir, { recursive: true, force: true });
    console.log(`Cleaned up work directory: ${requestId}`);

    return {
      success: true,
      outputPath: persistentFinalVideo,
      outputUrl: uploadResult.fileUrl || `/download/${finalFilename}`,
      fileUrl: uploadResult.fileUrl,
      fileId: uploadResult.fileId,
      originalFilename: uploadResult.originalFilename || finalFilename,
      fileSize: uploadResult.fileSize || fs.statSync(persistentFinalVideo).size
    };
  } catch (error) {
    console.error('Error:', error.message);
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    throw error;
  }
}

app.get('/', (req, res) => {
  res.send(`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Video Template Automation</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 700px; margin: 40px auto; line-height: 1.5; }
    .spinner { display: none; width: 48px; height: 48px; border: 5px solid #ccc; border-top-color: #007bff; border-radius: 50%; animation: spin 1s linear infinite; margin: 20px auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .hidden { display: none; }
    .output { margin-top: 1rem; padding: 1rem; background: #f9f9f9; border: 1px solid #ddd; }
  </style>
</head>
<body>
  <h1>Upload Video + Optional Zip Images</h1>
  <form id="uploadForm">
    <label>Video file:<br/><input type="file" name="video" accept="video/*" required /></label><br/><br/>
    <label>Images ZIP (optional):<br/><input type="file" name="zip" accept=".zip" /></label><br/><br/>
    <button type="submit">Start Processing</button>
  </form>
  <div class="spinner" id="spinner"></div>
  <div class="output" id="result" aria-live="polite"></div>

  <script>
    const form = document.getElementById('uploadForm');
    const spinner = document.getElementById('spinner');
    const result = document.getElementById('result');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      result.innerHTML = '';
      spinner.style.display = 'block';

      const data = new FormData(form);

      try {
        const response = await fetch('/upload', { method: 'POST', body: data });
        const json = await response.json();

        if (!response.ok) {
          result.innerHTML = '<strong style="color:red;">Error: ' + (json.error || 'Processing failed') + '</strong>';
          return;
        }

        const dlUrl = json.outputUrl || json.fileUrl;
        result.innerHTML = '<strong>Success!</strong><br/>' +
          'Output Path: ' + json.outputPath + '<br/>' +
          'Download: <a href="' + dlUrl + '" target="_blank">' + dlUrl + '</a>';
      } catch (err) {
        result.innerHTML = '<strong style="color:red;">Network error: ' + err.message + '</strong>';
      } finally {
        spinner.style.display = 'none';
      }
    });
  </script>
</body>
</html>
  `);
});

app.post('/upload', upload.fields([{ name: 'video', maxCount: 1 }, { name: 'zip', maxCount: 1 }]), async (req, res) => {
  const videoFile = req.files?.video?.[0];
  const zipFile = req.files?.zip?.[0];

  if (!videoFile) {
    return res.status(400).json({ error: 'Video file is required' });
  }

  const videoPath = videoFile.path;
  const zipPath = zipFile ? zipFile.path : null;

  try {
    const result = await processVideo(videoPath, false, zipPath, false, null, null);
    return res.json(result);
  } catch (error) {
    console.error('upload error', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    // Clean uploaded temp files
    try {
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (zipPath && fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    } catch (cleanupErr) {
      console.warn('Failed to cleanup upload temp files', cleanupErr.message);
    }
  }
});

app.post('/process', async (req, res) => {
  try {
    const { videoPath, isUrl, zipPath, zipUrl, userId, imageUrls } = req.body;
    
    if (!videoPath) {
      return res.status(400).json({ error: 'videoPath is required' });
    }

    console.log('\n========== NEW REQUEST ==========');
    console.log(`Video: ${videoPath}`);
    console.log(`Video Is URL: ${isUrl}`);
    console.log(`Zip: ${zipPath || 'none'}`);
    console.log(`Zip Is URL: ${zipUrl}`);
    console.log(`Image URLs: ${imageUrls ? imageUrls.length + ' images' : 'none'}`);
    console.log(`UserId: ${userId || 'default'}\n`);

    const result = await processVideo(videoPath, isUrl, zipPath, zipUrl, userId, imageUrls);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(__dirname, 'output', filename);
  
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  res.download(filepath);
});

app.get('/status', (req, res) => {
  res.json({ status: 'running' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`   POST /process { "videoPath": "...", "isUrl": false, "zipPath": "..." | "imageUrls": [...] }`);
  console.log(`   GET  /download/<filename>`);
});
