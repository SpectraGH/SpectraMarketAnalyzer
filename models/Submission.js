const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
    id: Number,
    name: String,
    email: String,
    sku: String,
    description: String,
    metal: String,
    grams: Number,
    calculatedPrice: String,
    action: String,
    imagePath: String,
    timestamp: { type: Date, default: Date.now }
});

const Submission = mongoose.model('Submission', submissionSchema);

module.exports = Submission; 