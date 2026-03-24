const fs = require('fs');
const path = require('path');

const workDir = process.argv[2] || '.';
const OUTPUT_DIR = path.join(workDir, 'output');
const INPUT_IMAGE = path.join(OUTPUT_DIR, 'last-frame.png');
const BG_REMOVED_IMAGE = path.join(OUTPUT_DIR, 'bg-removed.png');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function removeBackground(imagePath) {
  console.log('Removing background using @imgly/background-removal-node (local ML)...');
  console.log(`Input: ${imagePath}`);

  try {
    const { removeBackground } = await import('@imgly/background-removal-node');

    console.log('Loading image...');
    const imageBuffer = fs.readFileSync(imagePath);
    const blob = new Blob([imageBuffer], { type: 'image/png' });

    console.log('Processing (this may take a moment on first run as the model downloads)...');
    const resultBlob = await removeBackground(blob);

    console.log('Saving result...');
    const resultBuffer = Buffer.from(await resultBlob.arrayBuffer());
    fs.writeFileSync(BG_REMOVED_IMAGE, resultBuffer);

    console.log(`✅ Background removed successfully!`);
    console.log(`📁 Saved to: ${BG_REMOVED_IMAGE}`);

    return BG_REMOVED_IMAGE;
  } catch (error) {
    console.error('❌ Background removal failed:', error.message);
    throw error;
  }
}

console.log('🎨 Step 2: Removing background from last frame...');
console.log(`WorkDir: ${workDir}`);

removeBackground(INPUT_IMAGE)
  .then(() => {
    console.log('\n✨ Step 2 complete!');
    console.log(`Next: Add thick white borders to ${BG_REMOVED_IMAGE}`);
  })
  .catch((err) => {
    console.error('❌ Step 2 failed:', err.message);
    console.error(err);
    process.exit(1);
  });
