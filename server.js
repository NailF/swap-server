var express = require('express')
var orion = require('orion-atomic')
const fs = require('fs');
var mongoose = require('mongoose');
var Deposit = require('./deposit');

const app = express();

let rawdata = fs.readFileSync('./config.json');  
let config = JSON.parse(rawdata); 

let btcPublicKey = config.btcOrionPair.publicKey;
let wavesOrionAddress = config.wavesOrionAddress;
let btcOrionAddress = config.btcOrionAddress;
let faucetSeed = config.faucetSeed;

const regtestUtils = require('./_regtest')

const PORT = 5000;

const connectDb = () => {
  mongoose.connect('mongodb://admin:dnvAkGn5K9tJHqZNEeT5@51.15.60.255:27017/exchange-notifier', {useNewUrlParser: true});
  return mongoose.connection
}

const startServer = () =>{
	app.listen(PORT, () => {
  	console.log(`server running on port ${PORT}`)
});
}

async function participate(recipientAddress,amount,secretHash,deposit) {
	const respContract = await orion.wavesSwap.initiate(wavesOrionAddress, recipientAddress, faucetSeed, secretHash);
	
	await orion.wavesSwap.payToAddress(respContract.address, amount, faucetSeed);

	deposit.respContract = respContract;

	deposit.save(function (err) {
	    if (err) console.log(JSON.stringify(err));
	});
		
}

async function redeem(deposit){
	const watchedTx = await orion.wavesSwap.watchRedeemTx(deposit.respContract.address);
	const secretFromTx = Buffer.from(wc.base58decode(watchedTx.proofs[0]));
	const reedemBtcContract = new orion.types.Contract(null, deposit.address, deposit.contractScript, secretFromTx);
	const btcRedeemTx = await orion.btcSwap.redeem(reedemBtcContract, btcOrionAddress, config.btcOrionPair);

	await regtestUtils.broadcast(btcRedeemTx.toHex())
}

app.use(express.json())

app.post('/swap/paid/', async (req, res) => {
	let contractAddress = req.body.contractAddress;
	let address = req.body.address;
	let contractScript = req.body.contractScript;
	let recipientAddress = req.body.recipientAddress;
	
	const amount = await orion.btcSwap.settings.client.getBalance(contractAddress);
	try{
		const secretHash = orion.btcSwap.audit(address, contractScript, btcPublicKey, amount).toString('hex');
		var deposit = new Deposit({
		    address: address,
		    contractScript: contractScript,
		    recipientAddress: recipientAddress,
		    secretHash: secretHash,
		    amount:amount,
		    status:"NEW"
  		});
	  	deposit.save(function (err) {
	    	if (err) console.log(JSON.stringify(err));
	  	});
		res.status(200).send({
			address:address,
			amount:amount
		});

		participate();
	}catch(e){
		res.status(500).send();		
	}
	participate(recipientAddress,amount,secretHash);
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
	Deposit.findOne({ 'address': req.params.address }, function (err, deposit) {
  		if (err) return console.log(JSON.stringify(err));
  		deposit.status = "Redeeming";
  		deposit.save(function (err) {
	    	if (err) console.log(JSON.stringify(err));
	  	});
		res.status(200).send();
		await redeem(deposit.secretHash);
	})
});

app.get('/publicKey/btc/',(req, res) => {
	res.status(200).send({
		publicKey:btcPublicKey
	});
});

connectDb()
  .on('error', console.log)
  .on('disconnected', connectDb)
  .once('open', startServer)