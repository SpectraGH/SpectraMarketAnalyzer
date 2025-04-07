const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

// Configure Cloudinary if not already done in server.js
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dcvqytwuq',
    api_key: process.env.CLOUDINARY_API_KEY || '573695395824533',
    api_secret: process.env.CLOUDINARY_API_SECRET || '2CqOsEyaZZGBvVclLGNYuwHrhQs'
});

// Helper to format currency
const formatCurrency = (amount) => {
    if (typeof amount === 'string' && amount.startsWith('$')) {
        amount = parseFloat(amount.substring(1).replace(/,/g, ''));
    }
    
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
};

// Extract numeric price from formatted price string
const extractPriceNumeric = (priceStr) => {
    if (!priceStr) return 0;
    if (typeof priceStr === 'number') return priceStr;
    
    // Remove currency symbol and commas, then parse
    return parseFloat(priceStr.replace(/[$,]/g, ''));
};

// Generate invoice PDF for buyer
const generateInvoice = async (order) => {
    return new Promise((resolve, reject) => {
        try {
            // Ensure we have numeric price for calculations
            const priceNumeric = order.priceNumeric || extractPriceNumeric(order.calculatedPrice);
            
            // Create a PDF document
            const doc = new PDFDocument({ 
                margin: 50,
                size: 'A4',
                info: {
                    Title: `Invoice-${order.orderNumber}`,
                    Author: 'Spectra Metal Transactions',
                    Subject: `Invoice for order ${order.orderNumber}`
                }
            });
            
            // Prepare buffer to store PDF data
            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', async () => {
                const pdfData = Buffer.concat(buffers);
                
                // Upload to Cloudinary
                try {
                    const uploadResult = await uploadToCloudinary(pdfData, `invoice_${order.orderNumber}`);
                    resolve(uploadResult.secure_url);
                } catch (error) {
                    reject(error);
                }
            });
            
            // Set some basic styles
            const titleFont = 'Helvetica-Bold';
            const regularFont = 'Helvetica';
            const accentColor = '#000000'; // Red accent color
            const textColor = '#333333';
            
            // Add background color to header
            doc.rect(0, 0, doc.page.width, 120).fill('#f8f9fa');
            
            // Add company logo (try to use file if available, otherwise use text)
            try {
                const logoPath = path.join(__dirname, 'public/logo.jpg');
                if (fs.existsSync(logoPath)) {
                    doc.image(logoPath, 50, 45, { width: 80 });
                } else {
                    // Fallback: Just use text instead of image
                    doc.font(titleFont).fontSize(24).fillColor('#000000')
                        .text('SPECTRA', 50, 45);
                    doc.font(titleFont).fontSize(14).fillColor('#666666')
                        .text('METALS', 50, 75);
                }
            } catch (logoError) {
                // Fallback: Just use text instead of image
                doc.font(titleFont).fontSize(24).fillColor('#000000')
                    .text('SPECTRA', 50, 45);
                doc.font(titleFont).fontSize(14).fillColor('#666666')
                    .text('METALS', 50, 75);
            }
            
            // Company/Store info
            doc.font(titleFont).fontSize(22).fillColor(accentColor)
                .text('Spectra Metal Transactions', 150, 50, { align: 'right' });
            doc.font(regularFont).fontSize(10).fillColor(textColor)
                .text('123 Metal Street, New York, NY 10001', 150, 75, { align: 'right' })
                .text('admin@spectra.com | +1 (555) 123-4567', 150, 90, { align: 'right' })
                .text('www.spectrametals.com', 150, 105, { align: 'right' });
            
            // Add a horizontal line
            doc.moveTo(50, 140).lineTo(550, 140).lineWidth(1).strokeColor('#cccccc').stroke();
            
            // Invoice header
            doc.font(titleFont).fontSize(24).fillColor(accentColor)
                .text('INVOICE', 50, 160);
            
            // Invoice details
            doc.font(regularFont).fontSize(10).fillColor('#666666')
                .text('Invoice Number:', 350, 160)
                .text('Date:', 350, 175)
                .text('Status:', 350, 190);
                
            doc.font(regularFont).fontSize(10).fillColor(textColor)
                .text(`INV-${order.orderNumber}`, 400, 160, { align: 'right' })
                .text(`${new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, 400, 175, { align: 'right' })
                .text(`${order.status.toUpperCase()}`, 400, 190, { align: 'right' });
            
            // Customer Information
            doc.font(titleFont).fontSize(14).fillColor(accentColor)
                .text('BILL TO', 50, 230);
            doc.font(regularFont).fontSize(10).fillColor(textColor)
                .text(`${order.name}`, 50, 250)
                .text(`${order.email}`, 50, 265);
            
            // Shipping address if available
            if (order.deliveryAddress) {
                doc.font(titleFont).fontSize(14).fillColor(accentColor)
                    .text('SHIP TO', 350, 230);
                doc.font(regularFont).fontSize(10).fillColor(textColor)
                    .text(`${order.name}`, 350, 250)
                    .text(`${order.deliveryAddress.street || ''}`, 350, 265)
                    .text(`${order.deliveryAddress.city || ''}, ${order.deliveryAddress.state || ''} ${order.deliveryAddress.zipCode || ''}`, 350, 280)
                    .text(`${order.deliveryAddress.country || ''}`, 350, 295);
            }
            
            // Order Details
            doc.font(titleFont).fontSize(14).fillColor(accentColor)
                .text('ORDER DETAILS', 50, 330);
            
            // Add table header with background
            doc.rect(50, 350, 500, 20).fill('#f0f0f0');
            
            // Table header text
            doc.font(titleFont).fontSize(10).fillColor(textColor)
                .text('DESCRIPTION', 60, 356)
                .text('QUANTITY', 300, 356)
                .text('UNIT PRICE', 380, 356)
                .text('AMOUNT', 480, 356, { width: 70, align: 'right' });
            
            // Table content
            const lineY = 380;
            doc.font(regularFont).fontSize(10).fillColor(textColor)
                .text(`${order.metal} (Metal)`, 60, lineY)
                .text(`${order.grams} g`, 300, lineY)
                .text(formatCurrency(priceNumeric / order.grams) + '/g', 380, lineY)
                .text(formatCurrency(priceNumeric), 480, lineY, { width: 70, align: 'right' });
            
            // Add separator line
            doc.moveTo(50, lineY + 30).lineTo(550, lineY + 30).lineWidth(0.5).stroke();
            
            // Total
            doc.font(titleFont).fontSize(10).fillColor(textColor)
                .text('TOTAL', 350, lineY + 45)
                .font(titleFont).fontSize(14).fillColor(accentColor)
                .text(formatCurrency(priceNumeric), 450, lineY + 45, { width: 120, align: 'right' });
            
            // Add payment information
            doc.moveDown(4);
            doc.font(titleFont).fontSize(14).fillColor(accentColor)
                .text('PAYMENT INFORMATION', 50, 470);
            
            doc.font(regularFont).fontSize(10).fillColor(textColor)
                .text(`Payment Status: ${order.paymentStatus.toUpperCase()}`, 50, 490);
            
            if (order.paymentStatus === 'paid') {
                doc.text(`Payment Date: ${new Date(order.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, 50, 505)
                    .text(`Payment Method: Credit Card (Stripe)`, 50, 520);
            } else if (order.paymentStatus === 'pending') {
                doc.text('Please complete your payment using the payment link sent to your email.', 50, 505);
            }
            
            // Add notes
            doc.font(titleFont).fontSize(12).fillColor(accentColor)
                .text('NOTES', 50, 550);
            doc.font(regularFont).fontSize(10).fillColor(textColor)
                .text('Thank you for your business! If you have any questions about this invoice, please contact our customer service.', 50, 570, { width: 400 });
            
            // Add footer with background
            doc.rect(0, 700, doc.page.width, 100).fill('#f8f9fa');
            
            // Thank you note
            doc.font(titleFont).fontSize(12).fillColor(accentColor)
                .text('Thank you for your business!', 50, 720);
            
            // Footer
            doc.font(regularFont).fontSize(8).fillColor('#999999')
                .text('This is a computer-generated invoice and does not require a signature.', 50, 740)
                .text(`© ${new Date().getFullYear()} Spectra Metal Transactions. All rights reserved.`, 50, 755);
            
            // Finalize the PDF
            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};

// Generate receipt for sellers or buyers after payment
const generateReceipt = async (order) => {
    return new Promise((resolve, reject) => {
        try {
            // Ensure we have numeric price for calculations
            const priceNumeric = order.priceNumeric || extractPriceNumeric(order.calculatedPrice);
            
            // Create a PDF document
            const doc = new PDFDocument({ 
                margin: 50,
                size: 'A4',
                info: {
                    Title: `Receipt-${order.orderNumber}`,
                    Author: 'Spectra Metal Transactions',
                    Subject: `Receipt for order ${order.orderNumber}`
                }
            });
            
            // Prepare buffer to store PDF data
            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', async () => {
                const pdfData = Buffer.concat(buffers);
                
                // Upload to Cloudinary
                try {
                    const uploadResult = await uploadToCloudinary(pdfData, `receipt_${order.orderNumber}`);
                    resolve(uploadResult.secure_url);
                } catch (error) {
                    reject(error);
                }
            });
            
            // Set some basic styles
            const titleFont = 'Helvetica-Bold';
            const regularFont = 'Helvetica';
            const accentColor = order.action === 'sell' ? '#000000' : '#000000'; // Green for sell, Blue for buy receipts
            const textColor = '#333333';
            
            // Add background color to header
            doc.rect(0, 0, doc.page.width, 120).fill('#f8f9fa');
            
            // Add a logo image
            try {
                const logoPath = path.join(__dirname, '../public/logo.jpg');
                if (fs.existsSync(logoPath)) {
                    doc.image(logoPath, 50, 45, { width: 80 });
                } else {
                    // Fallback: Just use text instead of image
                    doc.font(titleFont).fontSize(24).fillColor('#000000')
                        .text('SPECTRA', 50, 45);
                    doc.font(titleFont).fontSize(14).fillColor('#666666')
                        .text('METALS', 50, 75);
                }
            } catch (logoError) {
                console.error('Logo error:', logoError);
                // Fallback: Just use text instead of image
                doc.font(titleFont).fontSize(24).fillColor('#000000')
                    .text('SPECTRA', 50, 45);
                doc.font(titleFont).fontSize(14).fillColor('#666666')
                    .text('METALS', 50, 75);
            }
            
            // Company/Store info
            doc.font(titleFont).fontSize(22).fillColor(accentColor)
                .text('Spectra Metal Transactions', 150, 50, { align: 'right' });
            doc.font(regularFont).fontSize(10).fillColor(textColor)
                .text('123 Metal Street, New York, NY 10001', 150, 75, { align: 'right' })
                .text('admin@spectra.com | +1 (555) 123-4567', 150, 90, { align: 'right' })
                .text('www.spectrametals.com', 150, 105, { align: 'right' });
            
            // Add a horizontal line
            doc.moveTo(50, 140).lineTo(550, 140).lineWidth(1).strokeColor('#cccccc').stroke();
            
            if (order.action === 'buy') {
                // Receipt header for buy orders (payment receipt)
                doc.font(titleFont).fontSize(24).fillColor(accentColor)
                    .text('PAYMENT RECEIPT', 50, 160);
                
                // Receipt details
                doc.font(regularFont).fontSize(10).fillColor('#666666')
                    .text('Receipt Number:', 350, 160)
                    .text('Payment Date:', 350, 175)
                    .text('Order Number:', 350, 190);
                    
                doc.font(regularFont).fontSize(10).fillColor(textColor)
                    .text(`RCP-${order.orderNumber}`, 400, 160, { align: 'right' })
                    .text(`${new Date(order.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, 400, 175, { align: 'right' })
                    .text(`${order.orderNumber}`, 400, 190, { align: 'right' });
                
                // Customer Information
                doc.font(titleFont).fontSize(14).fillColor(accentColor)
                    .text('CUSTOMER INFORMATION', 50, 230);
                doc.font(regularFont).fontSize(10).fillColor(textColor)
                    .text(`${order.name}`, 50, 250)
                    .text(`${order.email}`, 50, 265);
                if (order.phone) doc.text(`${order.phone}`, 50, 280);
                
                // Shipping address if available
                if (order.deliveryAddress) {
                    doc.font(titleFont).fontSize(14).fillColor(accentColor)
                        .text('SHIPPING ADDRESS', 350, 230);
                    doc.font(regularFont).fontSize(10).fillColor(textColor)
                        .text(`${order.name}`, 350, 250)
                        .text(`${order.deliveryAddress.street || ''}`, 350, 265)
                        .text(`${order.deliveryAddress.city || ''}, ${order.deliveryAddress.state || ''} ${order.deliveryAddress.zipCode || ''}`, 350, 280)
                        .text(`${order.deliveryAddress.country || ''}`, 350, 295);
                }
                
                // Payment Details
                doc.font(titleFont).fontSize(14).fillColor(accentColor)
                    .text('PAYMENT DETAILS', 50, 330);
                
                // Add payment info with background
                doc.rect(50, 350, 500, 20).fill('#f0f0f0');
                
                // Payment header text
                doc.font(titleFont).fontSize(10).fillColor(textColor)
                    .text('DESCRIPTION', 60, 356)
                    .text('PAYMENT METHOD', 300, 356)
                    .text('AMOUNT', 480, 356, { width: 70, align: 'right' });
                
                // Payment content
                const lineY = 380;
                doc.font(regularFont).fontSize(10).fillColor(textColor)
                    .text(`Purchase of ${order.grams}g ${order.metal}`, 60, lineY)
                    .text('Credit Card (Stripe)', 300, lineY)
                    .text(formatCurrency(priceNumeric), 480, lineY, { width: 70, align: 'right' });
                
                // Add separator line
                doc.moveTo(50, lineY + 30).lineTo(550, lineY + 30).lineWidth(0.5).stroke();
                
                // Total
                doc.font(titleFont).fontSize(10).fillColor(textColor)
                    .text('TOTAL PAID', 350, lineY + 45)
                    .font(titleFont).fontSize(14).fillColor(accentColor)
                    .text(formatCurrency(priceNumeric), 450, lineY + 45, { width: 120, align: 'right' });
                
                // Order details
                doc.moveDown(4);
                doc.font(titleFont).fontSize(14).fillColor(accentColor)
                    .text('ORDER DETAILS', 50, 470);
                
                doc.font(regularFont).fontSize(10).fillColor(textColor)
                    .text(`Order Date: ${new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, 50, 490)
                    .text(`Order Status: ${order.status.toUpperCase()}`, 50, 505)
                    .text(`Payment Status: ${order.paymentStatus.toUpperCase()}`, 50, 520);
                
                // Shipping information
                if (order.deliveryAddress) {
                    doc.moveDown(2);
                    doc.font(titleFont).fontSize(14).fillColor(accentColor)
                        .text('SHIPPING INFORMATION', 50, 550);
                    
                    doc.font(regularFont).fontSize(10).fillColor(textColor)
                        .text('Your order is now being processed and will be shipped to the address provided.', 50, 570, { width: 500 })
                        .text('You will receive a notification with tracking information once your order ships.', 50, 585, { width: 500 });
                }
            } 
            else {
                // Receipt header for sell orders
                doc.font(titleFont).fontSize(24).fillColor(accentColor)
                    .text('SELLING RECEIPT', 50, 160);
                
                // Receipt details
                doc.font(regularFont).fontSize(10).fillColor('#666666')
                    .text('Receipt Number:', 350, 160)
                    .text('Date:', 350, 175)
                    .text('Transaction Type:', 350, 190);
                    
                doc.font(regularFont).fontSize(10).fillColor(textColor)
                    .text(`RCP-${order.orderNumber}`, 400, 160, { align: 'right' })
                    .text(`${new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, 400, 175, { align: 'right' })
                    .text(`${order.action.toUpperCase()}`, 400, 190, { align: 'right' });
                
                // Seller Information
                doc.font(titleFont).fontSize(14).fillColor(accentColor)
                    .text('SELLER INFORMATION', 50, 230);
                doc.font(regularFont).fontSize(10).fillColor(textColor)
                    .text(`${order.name}`, 50, 250)
                    .text(`${order.email}`, 50, 265);
                if (order.phone) doc.text(`${order.phone}`, 50, 280);
                
                // Metal Details
                doc.font(titleFont).fontSize(14).fillColor(accentColor)
                    .text('METAL DETAILS', 50, 330);
                
                // Add table header with background
                doc.rect(50, 350, 500, 20).fill('#f0f0f0');
                
                // Table header text
                doc.font(titleFont).fontSize(10).fillColor(textColor)
                    .text('DESCRIPTION', 60, 356)
                    .text('QUANTITY', 300, 356)
                    .text('UNIT PRICE', 380, 356)
                    .text('AMOUNT', 480, 356, { width: 70, align: 'right' });
                
                // Table content
                const lineY = 380;
                doc.font(regularFont).fontSize(10).fillColor(textColor)
                    .text(`${order.metal} (Metal)`, 60, lineY)
                    .text(`${order.grams} g`, 300, lineY)
                    .text(formatCurrency(priceNumeric / order.grams) + '/g', 380, lineY)
                    .text(formatCurrency(priceNumeric), 480, lineY, { width: 70, align: 'right' });
                
                // Add separator line
                doc.moveTo(50, lineY + 30).lineTo(550, lineY + 30).lineWidth(0.5).stroke();
                
                // Total
                doc.font(titleFont).fontSize(10).fillColor(textColor)
                    .text('TOTAL OFFERED', 350, lineY + 45)
                    .font(titleFont).fontSize(14).fillColor(accentColor)
                    .text(formatCurrency(priceNumeric), 450, lineY + 45, { width: 120, align: 'right' });
                
                // Add shipping instructions
                doc.moveDown(4);
                doc.font(titleFont).fontSize(14).fillColor('#FF3B30')
                    .text('SHIPPING INSTRUCTIONS', 50, 470);
                
                // Create a bordered box for shipping address
                doc.rect(50, 490, 500, 120).lineWidth(2).dash(5, { space: 5 }).strokeColor('#FF3B30').stroke();
                
                doc.font(titleFont).fontSize(10).fillColor(textColor)
                    .text('PLEASE SHIP YOUR METAL TO:', 65, 505);
                
                doc.font(regularFont).fontSize(10).fillColor(textColor)
                    .text('Spectra Metal Transactions', 65, 525)
                    .text('123 Metal Street', 65, 540)
                    .text('New York, NY 10001', 65, 555)
                    .text('United States', 65, 570);
                    
                doc.font(titleFont).fontSize(10).fillColor(accentColor)
                    .text(`IMPORTANT: Include your reference number RCP-${order.orderNumber} with your shipment.`, 50, 595, { align: 'center' });
                
                // Add next steps
                doc.font(titleFont).fontSize(12).fillColor(accentColor)
                    .text('NEXT STEPS', 50, 630);
                doc.font(regularFont).fontSize(10).fillColor(textColor)
                    .text('1. Package your metal securely', 50, 650)
                    .text('2. Include your reference number with the shipment', 50, 665)
                    .text('3. Ship to the address above', 50, 680)
                    .text('4. Once we receive and verify your metals, we\'ll process your payment within 3-5 business days', 50, 695, { width: 500 });
            }
            
            // Add footer with background
            doc.rect(0, 730, doc.page.width, 100).fill('#f8f9fa');
            
            // Thank you note
            doc.font(titleFont).fontSize(12).fillColor(accentColor)
                .text('Thank you for choosing Spectra Metals!', 50, 730);
            
            // Footer
            doc.font(regularFont).fontSize(8).fillColor('#999999')
                .text('This is a computer-generated receipt and does not require a signature.', 50, 750)
                .text(`© ${new Date().getFullYear()} Spectra Metal Transactions. All rights reserved.`, 50, 765);
            
            // Finalize the PDF
            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};

// Upload buffer to Cloudinary
const uploadToCloudinary = async (buffer, fileName) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: 'metal_transactions_documents',
                resource_type: 'raw',
                public_id: fileName,
                format: 'pdf'
            },
            (error, result) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            }
        );
        
        // Convert buffer to stream and pipe to uploadStream
        const bufferStream = new Readable();
        bufferStream.push(buffer);
        bufferStream.push(null);
        bufferStream.pipe(uploadStream);
    });
};

module.exports = {
    generateInvoice,
    generateReceipt
}; 