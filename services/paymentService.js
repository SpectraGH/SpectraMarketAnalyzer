const stripe = require('../config/stripe');

/**
 * Create a Stripe payment session for redirect checkout
 * @param {Object} order - Order object
 * @param {string} successUrl - Redirect URL on successful payment
 * @param {string} cancelUrl - Redirect URL on cancelled payment
 * @returns {Promise<Object>} - Stripe session object
 */
const createPaymentSession = async (order, successUrl, cancelUrl) => {
    try {
        // Extract price from order
        const amountInCents = Math.round(order.priceNumeric * 100); // Convert to cents
        
        // Create a payment session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `${order.metal} - ${order.grams}g`,
                            description: `Purchase of ${order.grams}g of ${order.metal}`,
                        },
                        unit_amount: amountInCents,
                    },
                    quantity: 1,
                },
            ],
            customer_email: order.email,
            client_reference_id: order.orderNumber,
            metadata: {
                order_id: order.orderNumber,
                customer_name: order.name,
                metal: order.metal,
                grams: order.grams
            },
            mode: 'payment',
            success_url: successUrl,
            cancel_url: cancelUrl,
        });
        
        return session;
    } catch (error) {
        console.error('Error creating payment session:', error);
        throw error;
    }
};

/**
 * Process payment with Stripe Elements (on-site payment)
 * @param {Object} paymentData - Payment data including payment method or intent
 * @param {Object} order - Order data
 * @returns {Promise<Object>} - Payment processing result
 */
const processPayment = async (paymentData, order) => {
    try {
        const amountInCents = Math.round(order.priceNumeric * 100); // Convert to cents
        
        // If we have a payment method ID, create a new payment intent
        if (paymentData.payment_method_id) {
            const paymentIntent = await stripe.paymentIntents.create({
                payment_method: paymentData.payment_method_id,
                amount: amountInCents,
                currency: 'usd',
                confirm: true,
                description: `Order ${order.orderNumber}: ${order.metal} - ${order.grams}g`,
                receipt_email: order.email,
                metadata: {
                    order_number: order.orderNumber,
                    customer_name: order.name,
                    metal: order.metal,
                    grams: order.grams
                },
                return_url: `${process.env.BASE_URL || 'http://localhost:8000'}/orders/payment-success/${order.orderNumber}`
            });
            
            // Handle payment status
            if (paymentIntent.status === 'requires_action' && 
                paymentIntent.next_action && 
                paymentIntent.next_action.type === 'use_stripe_sdk') {
                // Card requires authentication
                return {
                    requires_action: true,
                    payment_intent_client_secret: paymentIntent.client_secret
                };
            } else if (paymentIntent.status === 'succeeded') {
                // Payment successful
                return {
                    success: true,
                    payment_intent: paymentIntent
                };
            } else {
                // Other status
                return {
                    error: {
                        message: `Payment failed with status: ${paymentIntent.status}`
                    }
                };
            }
        } 
        // If we have a payment intent ID, confirm the payment intent
        else if (paymentData.payment_intent_id) {
            const paymentIntent = await stripe.paymentIntents.confirm(
                paymentData.payment_intent_id
            );
            
            if (paymentIntent.status === 'succeeded') {
                return {
                    success: true,
                    payment_intent: paymentIntent
                };
            } else {
                return {
                    error: {
                        message: `Payment confirmation failed with status: ${paymentIntent.status}`
                    }
                };
            }
        } else {
            return {
                error: {
                    message: 'Invalid payment data. Missing payment method or intent ID.'
                }
            };
        }
    } catch (error) {
        console.error('Error processing payment:', error);
        return {
            error: {
                message: error.message
            }
        };
    }
};

/**
 * Verify a Stripe payment
 * @param {string} sessionId - Stripe session ID
 * @returns {Promise<Object>} - Payment verification result
 */
const verifyPayment = async (sessionId) => {
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        
        return {
            success: session.payment_status === 'paid',
            paymentStatus: session.payment_status,
            paymentIntent: session.payment_intent,
            customerId: session.customer,
            orderNumber: session.client_reference_id
        };
    } catch (error) {
        console.error('Error verifying payment:', error);
        throw error;
    }
};

/**
 * Create a refund for a payment
 * @param {string} paymentIntentId - Stripe payment intent ID
 * @param {number} amount - Amount to refund in cents
 * @returns {Promise<Object>} - Refund result
 */
const createRefund = async (paymentIntentId, amount = null) => {
    try {
        const refundParams = {
            payment_intent: paymentIntentId,
        };
        
        if (amount) {
            refundParams.amount = amount;
        }
        
        const refund = await stripe.refunds.create(refundParams);
        
        return {
            success: refund.status === 'succeeded',
            refundId: refund.id,
            status: refund.status
        };
    } catch (error) {
        console.error('Error creating refund:', error);
        throw error;
    }
};

module.exports = {
    createPaymentSession,
    processPayment,
    verifyPayment,
    createRefund
}; 