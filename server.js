var express = require('express')
var orion = require('orion-atomic')
const fs = require('fs');
var mongoose = require('mongoose');
var Deposit = require('./deposit');
const bitcoin = require('bitcoinjs-lib')
const wc = require('@waves/waves-crypto')
const regtestUtils = require('./_regtest')

const app = express();


let rawdata = fs.readFileSync('./config.json');  
let config = JSON.parse(rawdata); 

let dbRawdata = fs.readFileSync('./db.json');  
let dbConfig = JSON.parse(dbRawdata); 

// let btcPublicKey = config.btcOrionPair.publicKey;
// let wavesOrionAddress = config.wavesOrionAddress;
// let btcOrionAddress = config.btcOrionAddress;
let faucetSeed = config.faucetSeed;



orion.btcSwap.settings.network = regtestUtils.network
orion.btcSwap.settings.client = {unspents: regtestUtils.unspents, calcFee: regtestUtils.calcFee, getBalance: regtestUtils.getBalance}

orion.wavesSwap.settings.network = 'T'
orion.wavesSwap.settings.nodeUrl = 'https://pool.testnet.wavesnodes.com'
orion.wavesSwap.settings.assetId = 'EBJDs3MRUiK35xbj59ejsf5Z4wH9oz6FuHvSCHVQqZHS'


const PORT = 5000;

//TEST
const btcOrionPair = bitcoin.ECPair.fromWIF('cScfkGjbzzoeewVWmU2hYPUHeVGJRDdFt7WhmrVVGkxpmPP8BHWe', orion.btcSwap.settings.network);
const wavesOrionAddress = wc.address('orion', orion.wavesSwap.settings.network)
const btcOrionAddress = regtestUtils.getAddress(btcOrionPair)

console.log(btcOrionPair.publicKey.toString('hex'))

const connectDb = () => {
  let dbUrl = `mongodb://${dbConfig.login}:${dbConfig.password}@${dbConfig.ip}:27017/${dbConfig.dbName}`;
  mongoose.connect(dbUrl, {useNewUrlParser: true});
  return mongoose.connection
}

const startServer = () =>{
	app.listen(PORT, () => {
  	console.log(`server running on port ${PORT}`)
});
}

async function participate(recipientAddress,amount,secretHash,deposit) {
	try {
        const respContract = await orion.wavesSwap.initiate(wavesOrionAddress, recipientAddress, faucetSeed, secretHash);
    } catch (e) {
        console.log(e);
        throw e;
    }
	
	await orion.wavesSwap.payToAddress(respContract.address, amount, faucetSeed);

	deposit.respContract = respContract;

	deposit.save(function (err) {
	    if (err) console.log(JSON.stringify(err));
	});

	return true
}

async function redeem(deposit){
	const watchedTx = await orion.wavesSwap.watchRedeemTx(deposit.respContract.address);
	const secretFromTx = Buffer.from(wc.base58decode(watchedTx.proofs[0]));
	const reedemBtcContract = new orion.types.Contract(null, deposit.address, deposit.contractScript, secretFromTx);
	const btcRedeemTx = await orion.btcSwap.redeem(reedemBtcContract, btcOrionAddress, config.btcOrionPair);

	await regtestUtils.broadcast(btcRedeemTx.toHex())
}

app.use(express.json())

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.post('/swap/paid/', async (req, res) => {
	let contractAddress = req.body.address;
	let contractScript = Buffer.from(req.body.contractScript, 'hex');
	let recipientAddress = req.body.recipientAddress;
	
	const amount = await orion.btcSwap.settings.client.getBalance(contractAddress);
	console.log("amount " + amount);
	try{
		const secretHash = await orion.btcSwap.audit(contractAddress, contractScript, btcOrionPair.publicKey, amount);
		console.log("secretHash " + secretHash)
		var deposit = new Deposit({
		    address: contractAddress,
		    contractScript: contractScript.toString('hex'),
		    recipientAddress: recipientAddress,
		    secretHash: secretHash,
		    amount:amount,
		    status:"NEW"
  		});
	  	deposit.save(function (err) {
	    	if (err) {
	    		console.log("Error while saving to db")
	    		console.log(JSON.stringify(err));
	    	}
	  	});
		res.status(200).send({
			address:contractAddress,
			amount:amount
		});

		participate(recipientAddress,amount,secretHash);
	}catch(e){
		console.log(JSON.stringify(e))
		console.log(e);
		res.status(500).send();		
	}
});

app.get('/swap/:address',(req, res) => {
	Deposit.findOne({ 'address': req.params.address }, function (err, deposit) {
  		if (err) return console.log(JSON.stringify(err));
  		
		if(deposit.respContract){
			res.status(200).send({
				address:deposit.address,
		   		status: 'ready',
		   		respContract:{
		   			address:deposit.respContract.address,
		   			publicKey:deposit.respContract.publicKey
		   		}
		   	});
		}else{
			res.status(200).send({
	   			status: 'pending'
	   		});
		}
	})
});

app.post('/swap/:address/redeem/', async (req, res) => {
	Deposit.findOne({ 'address': req.params.address }, async function (err, deposit) {
  		if (err) return console.log(JSON.stringify(err));
  		deposit.status = "Redeeming";
  		deposit.save(function (err) {
	    	if (err) console.log(JSON.stringify(err));
	  	});
		res.status(200).send();
		await redeem(deposit);
	})
});

app.get('/publicKey/btc',(req, res) => {
	res.status(200).send({
		publicKey: btcOrionPair.publicKey.toString('hex')
	});
});

connectDb()
  .on('error', console.log)
  .on('disconnected', connectDb)
  .once('open', startServer)