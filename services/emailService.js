const nodemailer = require('nodemailer');
const ejs = require('ejs');
const path = require('path');
const fs = require('fs');

// Create transport with environment variables
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: process.env.EMAIL_PORT || 587,
    secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER || 'your-email@gmail.com', // replace with actual email in production
        pass: process.env.EMAIL_PASS || 'your-password' // replace with actual password in production
    }
});

// Path to email templates
const templatesDir = path.join(__dirname, '../views/emails');

// Function to render email template with data
const renderTemplate = async (templateName, data) => {
    const templatePath = path.join(templatesDir, `${templateName}.ejs`);
    
    // Check if template file exists, create if not
    if (!fs.existsSync(templatePath)) {
        // Create the directory if it doesn't exist
        if (!fs.existsSync(templatesDir)) {
            fs.mkdirSync(templatesDir, { recursive: true });
        }
        
        // Create a basic template if one doesn't exist
        const basicTemplate = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title><%= subject %></title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #f8f9fa; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; }
        .button { display: inline-block; background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="header">
        <h1><%= subject %></h1>
    </div>
    <div class="content">
        <%= message %>
    </div>
    <div class="footer">
        <p>© <%= new Date().getFullYear() %> Spectra Metal Transactions. All rights reserved.</p>
    </div>
</body>
</html>`;
        
        fs.writeFileSync(templatePath, basicTemplate);
    }
    
    return await ejs.renderFile(templatePath, data);
};

// Send email function
const sendEmail = async (options) => {
    try {
        const { to, subject, template, data, attachments } = options;
        
        // Add admin as BCC
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@spectra.com';
        
        // Render HTML
        const html = await renderTemplate(template, { ...data, subject });
        
        // Mail options
        const mailOptions = {
            from: process.env.EMAIL_FROM || '"Spectra Metals" <noreply@spectra.com>',
            to,
            subject,
            html,
            bcc: adminEmail,
            attachments: attachments || []
        };
        
        // Send email
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Error sending email:', error);
        return { success: false, error: error.message };
    }
};

// Send Buy confirmation email
const sendBuyConfirmation = async (order) => {
    return await sendEmail({
        to: order.email,
        subject: 'Your Metal Purchase Order Confirmation',
        template: 'buy-confirmation',
        data: {
            order
        }
    });
};

// Send Sell confirmation email
const sendSellConfirmation = async (order) => {
    return await sendEmail({
        to: order.email,
        subject: 'Your Metal Selling Order Confirmation',
        template: 'sell-confirmation',
        data: {
            order
        }
    });
};

// Send payment receipt
const sendPaymentReceipt = async (order) => {
    return await sendEmail({
        to: order.email,
        subject: 'Payment Receipt for Your Metal Purchase',
        template: 'payment-receipt',
        data: {
            order
        },
        attachments: order.receiptUrl ? [
            {
                filename: `receipt-${order.orderNumber}.pdf`,
                path: order.receiptUrl
            }
        ] : []
    });
};

module.exports = {
    sendEmail,
    sendBuyConfirmation,
    sendSellConfirmation,
    sendPaymentReceipt
}; 