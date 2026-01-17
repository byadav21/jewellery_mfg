const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('fs');
const pathMod = require('path');
const { SkuMaster } = require('../models');

/**
 * Service to generate PDF Job Sheets
 */
class PdfService {
    /**
     * Generates a Job Sheet PDF for a specific job
     * @param {Object} job - The job document (populated with order/item info)
     * @returns {Promise<String>} - The path to the generated PDF
     */
    async generateJobSheet(job) {
        return new Promise(async (resolve, reject) => {
            try {
                const uploadDir = pathMod.join(__dirname, '../../uploads/job-sheets');
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }

                const fileName = `JobSheet_${job.jobCode}_${Date.now()}.pdf`;
                const filePath = pathMod.join(uploadDir, fileName);
                const relativePath = `/uploads/job-sheets/${fileName}`;

                const doc = new PDFDocument({ margin: 50 });
                const stream = fs.createWriteStream(filePath);

                doc.pipe(stream);

                // Header
                doc.fontSize(20).text('JOB MANUFACTURING SHEET', { align: 'center' });
                doc.moveDown();

                // Job & SKU Info
                doc.fontSize(12).font('Helvetica-Bold').text(`Job Code: `, { continued: true }).font('Helvetica').text(job.jobCode);
                doc.fontSize(12).font('Helvetica-Bold').text(`SKU: `, { continued: true }).font('Helvetica').text(job.sku || 'N/A');
                doc.fontSize(12).font('Helvetica-Bold').text(`Product: `, { continued: true }).font('Helvetica').text(job.productName || 'N/A');
                doc.fontSize(12).font('Helvetica-Bold').text(`Quantity: `, { continued: true }).font('Helvetica').text(String(job.quantity || 1));
                doc.fontSize(12).font('Helvetica-Bold').text(`Priority: `, { continued: true }).font('Helvetica').text(job.priority || 'medium');
                doc.fontSize(12).font('Helvetica-Bold').text(`Due Date: `, { continued: true }).font('Helvetica').text(job.dueDate ? new Date(job.dueDate).toLocaleDateString() : 'N/A');

                doc.moveDown();

                // Image section
                let imageAdded = false;

                // Try to get image from SkuMaster first
                if (job.sku) {
                    const skuMaster = await SkuMaster.findOne({ sku: job.sku.toUpperCase() });
                    if (skuMaster && skuMaster.images && skuMaster.images.length > 0) {
                        const mainImage = skuMaster.images[0];
                        const imagePath = pathMod.join(__dirname, '../../', mainImage.filePath);

                        if (fs.existsSync(imagePath)) {
                            try {
                                // Add image with 300x300 dimensions
                                doc.image(imagePath, {
                                    fit: [300, 300],
                                    align: 'center',
                                    valign: 'center'
                                });
                                imageAdded = true;
                                doc.moveDown(15); // Move down enough for the 300x300 image
                            } catch (imgErr) {
                                console.error('Error adding SKU image to PDF:', imgErr);
                            }
                        }
                    }
                }

                // Fallback or additional details
                doc.fontSize(12).font('Helvetica-Bold').text('Notes:');
                doc.font('Helvetica').text(job.manufacturingNotes || 'None');
                doc.moveDown();

                // Clickable STL Link
                if (job.cadFilePath) {
                    const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
                    const downloadUrl = `${baseUrl}${job.cadFilePath}`;

                    doc.fontSize(14).font('Helvetica-Bold').fillColor('blue')
                        .text('DOWNLOAD STL FILE', {
                            link: downloadUrl,
                            underline: true
                        });
                    doc.fillColor('black');
                } else {
                    doc.fontSize(12).font('Helvetica-Oblique').text('No STL file associated with this job.');
                }

                // Footer
                doc.fontSize(10).text(`Generated on ${new Date().toLocaleString()}`, {
                    align: 'center',
                    bottom: 20
                });

                doc.end();

                stream.on('finish', () => {
                    resolve(relativePath);
                });

                stream.on('error', (err) => {
                    reject(err);
                });

            } catch (error) {
                console.error('PDF Generation Error:', error);
                reject(error);
            }
        });
    }
}

module.exports = new PdfService();
