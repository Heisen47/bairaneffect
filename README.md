# Video Template Automation

Create dynamic videos with a freeze-frame transition, AI background removal, and a slideshow curtain effect.

## 🚀 Quick Start

Follow these simple steps to generate your video:

### 1. Install Dependencies
```bash
npm i
```

### 2. Start the Server
```bash
npm start
```

### 3. Generate Video
1. Open your browser and go to **[http://localhost:3001](http://localhost:3001)**
2. **Upload** your main video file (e.g., `.mov` or `.mp4`).
3. *(Optional)* Upload a `.zip` file containing photos for the middle slideshow.
4. Click **Start Processing** and wait for the automation to finish.
5. Once it's done, click the **Download** link to get your final composed video!

---

## 🛠 How It Works

Behind the scenes, the automation runs a 4-step processing pipeline:

1. **Extract Last Frame**: Grabs the very last frame of your uploaded video.
2. **AI Background Removal**: Uses `@imgly/background-removal-node` (runs locally, no API key needed) to cut out the subject from the frame.
3. **Sticker Effect**: Adds crisp, white borders around the subject to create a professional "sticker" look.
4. **Compose Final Video**: Extends the main video, creates a center-out curtain reveal revealing the middle photos, and overlays the sticker on top.

## 📁 Project Structure

```
bairaneffect/
├── server.js               # Web UI & API Server
├── step1-extract-last-frame.js
├── step2-remove-background.js # Local ML background removal
├── step3-add-borders.js    # Sharp-based image dilation
├── step4-compose-video.js  # FFmpeg composition magic
├── create-middle-slideshow.js
├── package.json
└── temp-uploads/           # Temporary storage during processing
```

## ⚙️ Advanced: API Usage

If you prefer to use the API directly instead of the web UI:

```bash
curl -X POST http://localhost:3001/process \
  -H "Content-Type: application/json" \
  -d '{
    "videoPath": "path/to/video.mp4",
    "isUrl": false
  }'
```
Response:
```json
{
  "success": true,
  "outputPath": "output/final-video.mp4",
  "outputUrl": "/download/final-video.mp4"
}
```
