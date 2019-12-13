require('dotenv-safe').config()

const { MAILGUN_PASS } = process.env
const nodemailer = require('nodemailer')
const MongoClient = require('mongodb').MongoClient

function sendEmail(to, subject, message) {
	const mailTransporter = nodemailer.createTransport({
		service: 'Mailgun',
		auth: {
			user: 'postmaster@mg.comprarymirar.com',
			pass: MAILGUN_PASS,
		}
	})
	const mailOptions = {
    // Recover your account to login
		from: 'account@postmaster.com',
		to: to,
		subject: subject,
		html: message,
	}
	return new Promise((resolve, reject) => {
		mailTransporter.sendMail(mailOptions, (err, info) => {
			if(err) return reject(err)
			resolve(info)
		})
	})
}

module.exports = sendEmail
