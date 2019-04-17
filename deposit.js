var mongoose = require('mongoose');
 
var depositSchema = mongoose.Schema({
    address: String,
    contractScript: String,
    recipientAddress: String,
    secretHash: String,
    amount:Number,
    status:String,
    respContract: {
        publicKey: String,
        address: String,
        script: String,
        secret: String,
        secretHash: String
    },
});
 
var Deposit = mongoose.model('Deposit', depositSchema);
 
module.exports = Deposit;