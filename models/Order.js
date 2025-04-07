const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    submissionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Submission',
        required: true
    },
    customerId: String,
    orderNumber: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true
    },
    phone: String,
    deliveryAddress: {
        street: String,
        city: String,
        state: String,
        zipCode: String,
        country: String
    },
    metal: {
        type: String,
        required: true
    },
    grams: {
        type: Number,
        required: true
    },
    calculatedPrice: {
        type: String,
        required: true
    },
    priceNumeric: {
        type: Number,
        required: true
    },
    action: {
        type: String,
        enum: ['buy', 'sell', 'invest'],
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'paid', 'shipped', 'delivered', 'cancelled'],
        default: 'pending'
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded'],
        default: 'pending'
    },
    stripeSessionId: String,
    stripePaymentIntentId: String,
    invoiceUrl: String,
    receiptUrl: String,
    notes: String,
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Pre-save middleware to update the updatedAt field
orderSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

const Order = mongoose.model('Order', orderSchema);

module.exports = Order; 