const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const heicConvert = require('heic-convert');

const FFMPEG = 'ffmpeg';
const IMAGES_DIR = process.argv[2] || 'middle-images';
const OUTPUT = process.argv[3] || path.join(__dirname, 'output/middle-slideshow.mp4');
const DURATION = 9;
const IMAGE_DURATION = 0.20;

const OUTPUT_DIR = path.dirname(OUTPUT);
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function createSlideshow() {
  console.log(`🎬 Creating looping slideshow from ${IMAGES_DIR}\n`);
  console.log(`Output: ${OUTPUT}\n`);

  function collectImageFiles(dir) {
    const imageExt = /\.(jpg|jpeg|png|heic)$/i;
    let collected = [];
    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith('.') || entry === '__MACOSX') continue;
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        collected = collected.concat(collectImageFiles(fullPath));
      } else if (stat.isFile() && imageExt.test(entry)) {
        collected.push(fullPath);
      }
    }
    return collected;
  }

  const imageFiles = collectImageFiles(IMAGES_DIR).sort();

  if (imageFiles.length === 0) {
    console.error(`No images found in ${IMAGES_DIR}`);
    process.exit(1);
  }

  console.log(`Found ${imageFiles.length} images`);
  console.log(`Each image displays for ${IMAGE_DURATION}s`);

  const totalFrames = Math.ceil(DURATION / IMAGE_DURATION);
  console.log(`Total frames: ${totalFrames}\n`);

  const tempDir = path.join(OUTPUT_DIR, 'temp-images');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  console.log('Converting to JPG (parallel)...');
  
  const convertedFiles = [];
  for (let idx = 0; idx < imageFiles.length; idx++) {
    const inputPath = imageFiles[idx];
    const ext = path.extname(inputPath).toLowerCase();
    const jpgPath = path.join(tempDir, `img_${String(idx + 1).padStart(3, '0')}.jpg`);

    try {
      if (ext === '.heic') {
        const inputBuffer = fs.readFileSync(inputPath);
        const outputBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 0.95 });
        fs.writeFileSync(jpgPath, outputBuffer);
      } else {
        execSync(`convert "${inputPath}" "${jpgPath}"`, { stdio: 'ignore' });
      }
      convertedFiles.push(jpgPath);
    } catch (e) {
      console.log(`✗ Failed convert: ${inputPath} — ${e.message}`);
    }
  }

  if (convertedFiles.length === 0) {
    console.error('No images could be converted to JPG, stopping slideshow creation.');
    process.exit(1);
  }

  console.log(`✓ Converted ${convertedFiles.length}/${imageFiles.length} images`);
  console.log('');

  const listFile = path.join(tempDir, 'list.txt');
  let listContent = '';
  
  for (let i = 0; i < totalFrames; i++) {
    const imgIndex = i % convertedFiles.length;
    const imgPath = path.basename(convertedFiles[imgIndex]);
    listContent += `file '${imgPath}'\n`;
    listContent += `duration ${IMAGE_DURATION}\n`;
  }

  const lastImg = convertedFiles[(totalFrames - 1) % convertedFiles.length];
  if (lastImg) {
    listContent += `file '${path.basename(lastImg)}'\n`;
  }

  fs.writeFileSync(listFile, listContent);
  console.log('Created image list file');

  console.log('Generating slideshow video...');
  const absoluteOutput = path.resolve(OUTPUT);
  execSync(
    `${FFMPEG} -y -f concat -safe 0 -i "${listFile}" -r 30 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1" -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -t ${DURATION} "${absoluteOutput}"`,
    { stdio: 'inherit' }
  );

  fs.unlinkSync(listFile);
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('✓ Done\n');

  const dur = execSync(`${FFMPEG} -i "${OUTPUT}" 2>&1 | grep Duration | cut -d' ' -f4 | cut -d',' -f1`).toString().trim();
  console.log(`✅ Saved: ${OUTPUT}`);
  console.log(`Duration: ${dur}`);
}

createSlideshow().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
