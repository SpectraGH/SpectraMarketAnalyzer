const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Submission = require('../models/Submission');
const { createPaymentSession, verifyPayment, processPayment } = require('../services/paymentService');
const { generateInvoice, generateReceipt } = require('../services/documentService');
const { sendBuyConfirmation, sendSellConfirmation, sendPaymentReceipt } = require('../services/emailService');

// Helper function to extract numeric price
const extractNumericPrice = (priceString) => {
    if (!priceString) return 0;
    return parseFloat(priceString.replace(/[^0-9.]/g, '')) || 0;
};

// Create checkout page for Buy transactions
router.get('/checkout/:id', async (req, res) => {
    try {
        const submissionId = req.params.id;
        
        // Find the submission
        const submission = await Submission.findOne({ id: submissionId });
        
        if (!submission) {
            return res.status(404).render('error', { 
                message: 'Submission not found', 
                error: { status: 404, stack: '' } 
            });
        }
        
        // Check if it's a buy transaction
        if (submission.action !== 'buy') {
            return res.status(400).render('error', { 
                message: 'Only buy transactions can proceed to checkout', 
                error: { status: 400, stack: '' } 
            });
        }
        
        // Check if there's an existing paid order for this submission
        const existingOrder = await Order.findOne({ 
            submissionId: submission._id,
            paymentStatus: 'paid'
        });
        
        if (existingOrder) {
            // If order already exists and is paid, redirect to already paid page
            console.log(`Found existing paid order ${existingOrder.orderNumber} for submission ${submissionId}`);
            return res.render('payment-already-paid', {
                order: existingOrder.toObject()
            });
        }
        
        res.render('checkout', { submission });
    } catch (error) {
        console.error('Error loading checkout page:', error);
        res.status(500).render('error', { 
            message: 'Error loading checkout page', 
            error: { status: 500, stack: process.env.NODE_ENV === 'development' ? error.stack : '' } 
        });
    }
});

// Process checkout form submission
router.post('/checkout', async (req, res) => {
    try {
        const {
            submissionId,
            name,
            email,
            phone,
            street,
            city,
            state,
            zipCode,
            country,
            notes
        } = req.body;
        
        // Find the submission
        const submission = await Submission.findOne({ id: submissionId });
        
        if (!submission) {
            return res.status(404).json({ 
                success: false, 
                message: 'Submission not found' 
            });
        }

        // Check if there's an existing paid order for this submission
        const existingOrder = await Order.findOne({ 
            submissionId: submission._id,
            paymentStatus: 'paid'
        });
        
        if (existingOrder) {
            // If order already exists and is paid, return information about it
            console.log(`Found existing paid order ${existingOrder.orderNumber} for submission ${submissionId}`);
            return res.json({
                success: true,
                already_paid: true,
                message: 'This order has already been paid',
                orderNumber: existingOrder.orderNumber,
                redirectUrl: `/orders/payment-already-paid/${existingOrder.orderNumber}`
            });
        }
        
        // Generate a unique order number
        const orderNumber = `BUY-${Date.now().toString().slice(-8)}`;
        
        // Create a new order
        const order = new Order({
            submissionId: submission._id,
            orderNumber,
            name,
            email,
            phone,
            deliveryAddress: {
                street,
                city,
                state,
                zipCode,
                country
            },
            metal: submission.metal,
            grams: submission.grams,
            calculatedPrice: submission.calculatedPrice,
            priceNumeric: extractNumericPrice(submission.calculatedPrice),
            action: submission.action,
            status: 'pending',
            paymentStatus: 'pending',
            notes
        });
        
        // Save the order
        await order.save();
        
        // Generate invoice
        const invoiceUrl = await generateInvoice(order);
        
        // Update order with invoice URL
        order.invoiceUrl = invoiceUrl;
        
        // Add payment link for email
        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        order.paymentLink = `${baseUrl}/orders/payment/${orderNumber}`;
        
        console.log('Created order with payment link:', order.paymentLink);
        
        await order.save();
        
        // Send confirmation email with the updated order (including payment link)
        await sendBuyConfirmation(order.toObject());
        
        // For on-site payment, redirect to our payment page
        res.json({
            success: true,
            message: 'Order created successfully',
            redirectUrl: order.paymentLink,
            orderNumber
        });
    } catch (error) {
        console.error('Error processing checkout:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error processing checkout', 
            error: error.message 
        });
    }
});

// Render on-site payment page with Stripe Elements
router.get('/payment/:orderNumber', async (req, res) => {
    try {
        const { orderNumber } = req.params;
        
        // Find the order
        const order = await Order.findOne({ orderNumber });
        
        if (!order) {
            return res.status(404).render('error', { 
                message: 'Order not found', 
                error: { status: 404, stack: '' } 
            });
        }
        
        // Check if payment is already completed
        if (order.paymentStatus === 'paid') {
            // Render the already paid page instead of redirecting
            return res.render('payment-already-paid', {
                order: order.toObject()
            });
        }
        
        // Render the payment page with Stripe Elements
        res.render('payment', { 
            order: order.toObject(),
            stripePublicKey: process.env.STRIPE_PUBLIC_KEY || 'pk_test_your_publishable_key'
        });
    } catch (error) {
        console.error('Error loading payment page:', error);
        res.status(500).render('error', { 
            message: 'Error loading payment page', 
            error: { status: 500, stack: process.env.NODE_ENV === 'development' ? error.stack : '' } 
        });
    }
});

// Process payment with Stripe Elements (on-site payment)
router.post('/process-payment', async (req, res) => {
    try {
        const { payment_method_id, payment_intent_id, order_id, order_number } = req.body;
        
        // Find the order
        let order;
        if (order_id) {
            order = await Order.findById(order_id);
        } else if (order_number) {
            order = await Order.findOne({ orderNumber: order_number });
        } else {
            return res.status(400).json({ 
                success: false, 
                error: { message: 'Order ID or order number is required' } 
            });
        }
        
        if (!order) {
            return res.status(404).json({ 
                success: false, 
                error: { message: 'Order not found' } 
            });
        }
        
        // Check if payment is already completed
        if (order.paymentStatus === 'paid') {
            console.log(`Order ${order.orderNumber} is already paid. Skipping payment processing.`);
            return res.json({
                success: true,
                already_paid: true,
                message: 'Payment has already been processed for this order'
            });
        }
        
        // Process payment
        const paymentResult = await processPayment({ 
            payment_method_id, 
            payment_intent_id 
        }, order);
        
        // If payment was successful, update order status
        if (paymentResult.success) {
            order.paymentStatus = 'paid';
            order.status = 'processing';
            order.stripePaymentIntentId = paymentResult.payment_intent.id;
            
            // Generate receipt for buy transactions (we already have invoice)
            if (order.action === 'buy') {
                try {
                    // Generate receipt PDF
                    const receiptUrl = await generateReceipt(order);
                    order.receiptUrl = receiptUrl;
                } catch (receiptError) {
                    console.error('Error generating receipt:', receiptError);
                    // Continue even if receipt generation fails
                }
            }
            
            await order.save();
            
            // Send payment receipt email
            await sendPaymentReceipt(order.toObject());
        }
        
        // Return the result to the client
        res.json(paymentResult);
    } catch (error) {
        console.error('Error processing payment:', error);
        res.status(500).json({ 
            success: false, 
            error: { message: 'Error processing payment: ' + error.message } 
        });
    }
});

// Handle successful payment (from Stripe Elements or redirect)
router.get('/payment-success/:orderNumber', async (req, res) => {
    try {
        const { orderNumber } = req.params;
        
        // Find the order
        const order = await Order.findOne({ orderNumber });
        
        if (!order) {
            return res.status(404).render('error', { 
                message: 'Order not found', 
                error: { status: 404, stack: '' } 
            });
        }
        
        // Render success page
        res.render('payment-success', { 
            order: order.toObject()
        });
    } catch (error) {
        console.error('Error displaying payment success:', error);
        res.status(500).render('error', { 
            message: 'Error displaying payment success page', 
            error: { status: 500, stack: process.env.NODE_ENV === 'development' ? error.stack : '' } 
        });
    }
});

// Handle already paid orders
router.get('/payment-already-paid/:orderNumber', async (req, res) => {
    try {
        const { orderNumber } = req.params;
        
        // Find the order
        const order = await Order.findOne({ orderNumber });
        
        if (!order) {
            return res.status(404).render('error', { 
                message: 'Order not found', 
                error: { status: 404, stack: '' } 
            });
        }
        
        // Render already paid page
        res.render('payment-already-paid', { 
            order: order.toObject()
        });
    } catch (error) {
        console.error('Error displaying already paid page:', error);
        res.status(500).render('error', { 
            message: 'Error displaying already paid page', 
            error: { status: 500, stack: process.env.NODE_ENV === 'development' ? error.stack : '' } 
        });
    }
});

// Handle sell transactions
router.post('/sell-confirmation', async (req, res) => {
    try {
        const { submissionId } = req.body;
        
        // Find the submission
        const submission = await Submission.findOne({ id: submissionId });
        
        if (!submission) {
            return res.status(404).json({ 
                success: false, 
                message: 'Submission not found' 
            });
        }
        
        // Check if it's a sell transaction
        if (submission.action !== 'sell') {
            return res.status(400).json({ 
                success: false, 
                message: 'Only sell transactions can use this endpoint' 
            });
        }
        
        // Generate a unique order number
        const orderNumber = `SLL-${Date.now().toString().slice(-8)}`;
        
        // Create a new order
        const order = new Order({
            submissionId: submission._id,
            orderNumber,
            name: submission.name,
            email: submission.email,
            metal: submission.metal,
            grams: submission.grams,
            calculatedPrice: submission.calculatedPrice,
            priceNumeric: extractNumericPrice(submission.calculatedPrice),
            action: submission.action,
            status: 'pending',
            paymentStatus: 'pending',
            notes: submission.description
        });
        
        // Save the order
        await order.save();
        
        // Generate receipt
        const receiptUrl = await generateReceipt(order);
        
        // Update order with receipt URL
        order.receiptUrl = receiptUrl;
        await order.save();
        
        // Send confirmation email
        await sendSellConfirmation(order.toObject());
        
        // Return success
        res.json({
            success: true,
            message: 'Sell order created successfully',
            orderNumber,
            receiptUrl
        });
    } catch (error) {
        console.error('Error processing sell order:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error processing sell order', 
            error: error.message 
        });
    }
});

// Payment success route (for Stripe Checkout redirect)
router.get('/payment/success', async (req, res) => {
    try {
        const { session_id } = req.query;
        
        if (!session_id) {
            return res.status(400).render('error', { 
                message: 'Invalid session ID', 
                error: { status: 400, stack: '' } 
            });
        }
        
        // Verify payment
        const paymentVerification = await verifyPayment(session_id);
        
        if (!paymentVerification.success) {
            return res.status(400).render('error', { 
                message: 'Payment verification failed', 
                error: { status: 400, stack: '' } 
            });
        }
        
        // Find the order
        const order = await Order.findOne({ orderNumber: paymentVerification.orderNumber });
        
        if (!order) {
            return res.status(404).render('error', { 
                message: 'Order not found', 
                error: { status: 404, stack: '' } 
            });
        }
        
        // Update order status
        order.paymentStatus = 'paid';
        order.status = 'processing';
        order.stripePaymentIntentId = paymentVerification.paymentIntent;
        
        // Generate receipt for buy transactions (we already have invoice)
        if (order.action === 'buy') {
            try {
                // Generate receipt PDF
                const receiptUrl = await generateReceipt(order);
                order.receiptUrl = receiptUrl;
            } catch (receiptError) {
                console.error('Error generating receipt:', receiptError);
                // Continue even if receipt generation fails
            }
        }
        
        await order.save();
        
        // Send payment receipt
        await sendPaymentReceipt(order.toObject());
        
        // Redirect to success page
        res.redirect(`/orders/payment-success/${order.orderNumber}`);
    } catch (error) {
        console.error('Error processing payment success:', error);
        res.status(500).render('error', { 
            message: 'Error processing payment', 
            error: { status: 500, stack: process.env.NODE_ENV === 'development' ? error.stack : '' } 
        });
    }
});

// Payment cancel route
router.get('/payment/cancel', async (req, res) => {
    try {
        const { order } = req.query;
        
        res.render('payment-cancel', { orderNumber: order });
    } catch (error) {
        console.error('Error handling payment cancellation:', error);
        res.status(500).render('error', { 
            message: 'Error handling payment cancellation', 
            error: { status: 500, stack: process.env.NODE_ENV === 'development' ? error.stack : '' } 
        });
    }
});

// Get order details
router.get('/:orderNumber', async (req, res) => {
    try {
        const { orderNumber } = req.params;
        
        // Find the order
        const order = await Order.findOne({ orderNumber }).populate('submissionId');
        
        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order not found' 
            });
        }
        
        res.json({
            success: true,
            order: order.toObject()
        });
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching order details', 
            error: error.message 
        });
    }
});

// Check payment status (debugging endpoint)
router.get('/status/:orderNumber', async (req, res) => {
    try {
        const { orderNumber } = req.params;
        
        // Find the order
        const order = await Order.findOne({ orderNumber });
        
        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order not found' 
            });
        }
        
        // Return payment status details
        res.json({
            success: true,
            orderNumber: order.orderNumber,
            status: order.status,
            paymentStatus: order.paymentStatus,
            hasInvoice: !!order.invoiceUrl,
            hasReceipt: !!order.receiptUrl,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt
        });
    } catch (error) {
        console.error('Error checking payment status:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error checking payment status', 
            error: error.message 
        });
    }
});

module.exports = router; 