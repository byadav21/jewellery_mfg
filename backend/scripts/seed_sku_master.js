/**
 * Seed SKU Master records for all product-image folders
 * Run: node scripts/seed_sku_master.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// Import model
const SkuMaster = require('../src/models/SkuMaster');

const PRODUCT_IMAGES_DIR = path.join(__dirname, '../uploads/product-images');
const SKU_CAD_DIR = path.join(__dirname, '../uploads/sku-cad');

// Dummy data generation helpers
const categories = ['ring', 'necklace', 'bracelet', 'earring', 'pendant', 'chain', 'bangle', 'other'];
const metalTypes = ['Gold', 'Silver', 'Platinum', 'Rose Gold', 'White Gold', 'Sterling Silver'];
const purities = ['24K', '22K', '18K', '14K', '10K', '925 Sterling', '950 Platinum'];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateProductName(sku) {
  const prefixes = ['Elegant', 'Classic', 'Royal', 'Vintage', 'Modern', 'Luxury', 'Artisan', 'Heritage', 'Designer', 'Premium'];
  const types = ['Gemstone', 'Diamond', 'Sapphire', 'Ruby', 'Emerald', 'Topaz', 'Amethyst', 'Pearl', 'Opal', 'Turquoise'];
  return `${pickRandom(prefixes)} ${pickRandom(types)} ${sku}`;
}

function generateDescription(sku, category, metalType) {
  return `Handcrafted ${category} made with ${metalType}. SKU: ${sku}. Premium quality jewellery piece with excellent finish and design.`;
}

async function seedSkuMaster() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get all folders from product-images
    const entries = fs.readdirSync(PRODUCT_IMAGES_DIR, { withFileTypes: true });
    const folders = entries.filter(e => e.isDirectory()).map(e => e.name);

    console.log(`Found ${folders.length} folders to process`);

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const folder of folders) {
      const sku = folder.toUpperCase();

      try {
        // Check if SKU already exists
        const existing = await SkuMaster.findOne({ sku });
        if (existing) {
          // Update CAD file info if not already set
          if (!existing.hasCadFile) {
            const cadFilePath = path.join(SKU_CAD_DIR, `${sku}.stl`);
            if (fs.existsSync(cadFilePath)) {
              const stats = fs.statSync(cadFilePath);
              existing.cadFile = {
                fileName: `${sku}.stl`,
                filePath: `/uploads/sku-cad/${sku}.stl`,
                uploadedAt: new Date(),
                fileSize: stats.size
              };
              existing.hasCadFile = true;
              await existing.save();
              console.log(`  Updated CAD for existing SKU: ${sku}`);
            }
          }
          skipped++;
          continue;
        }

        const category = pickRandom(categories);
        const metalType = pickRandom(metalTypes);
        const purity = pickRandom(purities);
        const basePrice = Math.floor(Math.random() * 5000) + 50;
        const weight = +(Math.random() * 50 + 1).toFixed(2);

        // Check if STL file exists in sku-cad
        const cadFilePath = path.join(SKU_CAD_DIR, `${sku}.stl`);
        const hasCad = fs.existsSync(cadFilePath);
        let cadFile = null;

        if (hasCad) {
          const stats = fs.statSync(cadFilePath);
          cadFile = {
            fileName: `${sku}.stl`,
            filePath: `/uploads/sku-cad/${sku}.stl`,
            uploadedAt: new Date(),
            fileSize: stats.size
          };
        }

        // Get images from folder
        const folderPath = path.join(PRODUCT_IMAGES_DIR, folder);
        const files = fs.readdirSync(folderPath);
        const imageFiles = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        const images = imageFiles.map((img, idx) => ({
          fileName: img,
          filePath: `/uploads/product-images/${folder}/${img}`,
          isPrimary: idx === 0,
          uploadedAt: new Date(),
          source: img.includes('amazon') ? 'amazon' : img.includes('ebay') ? 'ebay' : 'manual'
        }));

        await SkuMaster.create({
          sku,
          productName: generateProductName(sku),
          description: generateDescription(sku, category, metalType),
          category,
          basePrice,
          weight,
          metalType,
          purity,
          cadFile,
          hasCadFile: hasCad,
          images,
          isActive: true
        });

        created++;
        if (created % 20 === 0) {
          console.log(`  Progress: ${created} created, ${skipped} skipped...`);
        }
      } catch (err) {
        console.error(`  Error for ${sku}: ${err.message}`);
        errors++;
      }
    }

    console.log('\n--- Seed Complete ---');
    console.log(`Created: ${created}`);
    console.log(`Skipped (already exist): ${skipped}`);
    console.log(`Errors: ${errors}`);
    console.log(`Total folders: ${folders.length}`);

  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

seedSkuMaster();
