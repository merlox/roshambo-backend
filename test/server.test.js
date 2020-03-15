const expect = require('chai').expect
const io = require('socket.io-client')
const MongoClient = require('mongodb').MongoClient
const mongoUrl = 'mongodb://localhost:27017/test' // Using the test environment
let socket = io('http://localhost')
let db = {}
let client = {} // The mongo client

// Used as an example user
let newUser = {
    email: 'example@gmail.com',
    password: 'example',
    username: 'example',
}

function registerUser(user, userSocket) {
    const registering = user || newUser
    const usingSocket = userSocket || socket
    return new Promise(async (resolve, reject) => {
        // Check if user exists already
        const foundUser = await db.collection('users').findOne({ email: registering.email })
        // Delete before adding it
        if (foundUser) {
            await db.collection('users').deleteOne({ email: registering.email })
        }
        usingSocket.emit('setup:register', registering)
        usingSocket.once('setup:login-complete', async () => {
            try {
                const user = await db.collection('users').findOne({ email: registering.email })
                expect(user).to.not.be.null
                resolve()
            } catch (e) {
                reject(e)
            }
        })
        usingSocket.once('issue', e => {
            reject(e.msg)
        })
    })
}

function loginUser(user) {
    return new Promise(async (resolve, reject) => {
        // Check if user exists already
        socket.emit('setup:login', user)
        socket.once('setup:login-complete', async res => {
            expect(res.response.msg).to.not.be.null
            resolve()
        })
        socket.once('issue', e => {
            reject(e.msg)
        })
    })
}

function createGame(game, userSocket) {
    const usingSocket = userSocket || socket
    return new Promise(async (resolve, reject) => {
        usingSocket.emit('game:create', game)
        usingSocket.once('game:create-complete', res => {
            resolve(res)
        })
        usingSocket.once('issue', res => {
            reject(res)
        })
    })
}

function joinGame(game, userSocket) {
    const usingSocket = userSocket || socket
    return new Promise(async (resolve, reject) => {
        usingSocket.emit('game:join', game)
        usingSocket.once('game:join-complete', res => {
            resolve(res)
        })
        usingSocket.once('issue', res => {
            reject(res)
        })
    })
}

function socketAsync () {
    return new Promise(resolve => {
        let mySocket = io('http://localhost')
        setTimeout(() => {
            resolve(mySocket)
        }, 1e2)
    })
}

async function createAndJoin() {
    let socket1 = await socketAsync()
    let socket2 = await socketAsync()
    let game1 = {
        gameName: 'Example',
        gameType: 'Rounds',
        rounds: 9,
        moveTimer: 99,
        totalCardsPlayerOne: 5,
    }
    let game2 = {
        playerOne: socket1.id,
        playerTwo: socket2.id,
        gameName: game1.gameName,
        gameType: game1.gameType,
        rounds: game1.rounds,
        moveTimer: game1.moveTimer,
        totalCardsPlayerTwo: 7,
    }
    let user1 = {
        email: 'example@gmail.com',
        password: 'example',
        username: 'example',
    }
    let user2 = {
        email: 'example22@gmail.com',
        password: 'example22',
        username: 'example22',
    }

    try {
        await registerUser(user1, socket1)
    } catch (e) {
        throw new Error(e)
    }
    try {
        let response = await createGame(game1, socket1)
        expect(response.msg).to.eq('The game has been created successfully')
        let foundGame = await db.collection('games').findOne({playerOne: socket1.id})
        expect(foundGame).to.not.be.null
    } catch (e) {
        expect(e).to.be.null
    }

    try {
        await registerUser(user2, socket2)
    } catch (e) {
        throw new Error(e)
    }
    try {
        let response = await joinGame(game2, socket2)
        expect(response.roomId).to.not.be.null
        expect(response.playerOne).to.eq(socket1.id)
        expect(response.playerTwo).to.eq(socket2.id)
    } catch (e) {
        expect(e).to.be.null
    }
    return {socket1, socket2}
}

describe('Server testing', async () => {
    before(async () => {
        client = new MongoClient(mongoUrl, {
            useUnifiedTopology: true,
        })
        await client.connect()
        db = client.db('roshambo')
    })

    it('Should connect 3 clients simultaneously', async () => {
        let socket1 = io('http://localhost')
        let socket2 = io('http://localhost')
        let socket3 = io('http://localhost')

        setTimeout(() => {
            expect(socket1.id).to.not.be.null
            expect(socket2.id).to.not.be.null
            expect(socket3.id).to.not.be.null
            socket1.disconnect()
            socket2.disconnect()
            socket3.disconnect()
        }, 1e2)
    })

    describe('User registration and login', async () => {
        beforeEach(async () => {
            await db.dropDatabase()
        })
        it('Should register a user properly with email', async () => {
            try {
                await registerUser()
            } catch (e) {
                throw new Error(e)
            }
        })
        it('Should login a user properly', async () => {
            try {
                await registerUser()
            } catch (e) {
                throw new Error(e)
            }
            let user = {
                email: 'example@gmail.com',
                password: 'example',
            }
            await loginUser(user)
        })
        it('Should throw an error when login with a non-existing user', async () => {
            let user = {
                email: 'aaaaaaaaaaaaaaaaaaaaaaa@gmail.com',
                password: 'fake',
            }
            try {
                await loginUser(user)
                // Should not continue
                expect(true).to.be.false
            } catch (e) {
                expect(e).to.eq('User not found')
            }
        })
    })

    describe('Game setup', async () => {
        beforeEach(async () => {
            await db.dropDatabase()
        })
        it('Should create a game successfully', async () => {
            let game = {
                gameName: 'Example',
                gameType: 'Rounds',
                rounds: 9,
                moveTimer: 99,
                totalCardsPlayerOne: 5,
            }

            try {
                await registerUser()
            } catch (e) {
                throw new Error(e)
            }

            try {
                let response = await createGame(game)
                expect(response.msg).to.eq('The game has been created successfully')
            } catch (e) {
                expect(e).to.be.null
            }
        })

        // Register 2 users with different sockets
        // Create a game for socker and user 1
        // Join a game for socket and user 2
        it('Should join a game successfully', async () => {
            let socket1 = await socketAsync()
            let socket2 = await socketAsync()
            let game1 = {
                gameName: 'Example',
                gameType: 'Rounds',
                rounds: 9,
                moveTimer: 99,
                totalCardsPlayerOne: 5,
            }
            let game2 = {
                playerOne: socket1.id,
                playerTwo: socket2.id,
                gameName: game1.gameName,
                gameType: game1.gameType,
                rounds: game1.rounds,
                moveTimer: game1.moveTimer,
                totalCardsPlayerTwo: 7,
            }
            let user1 = {
                email: 'example@gmail.com',
                password: 'example',
                username: 'example',
            }
            let user2 = {
                email: 'example22@gmail.com',
                password: 'example22',
                username: 'example22',
            }

            try {
                await registerUser(user1, socket1)
            } catch (e) {
                throw new Error(e)
            }
            try {
                let response = await createGame(game1, socket1)
                expect(response.msg).to.eq('The game has been created successfully')
                let foundGame = await db.collection('games').findOne({playerOne: socket1.id})
                expect(foundGame).to.not.be.null
            } catch (e) {
                expect(e).to.be.null
            }

            try {
                await registerUser(user2, socket2)
            } catch (e) {
                throw new Error(e)
            }
            try {
                let response = await joinGame(game2, socket2)
                expect(response.roomId).to.not.be.null
                expect(response.playerOne).to.eq(socket1.id)
                expect(response.playerTwo).to.eq(socket2.id)
            } catch (e) {
                expect(e).to.be.null
            }
        })
    })

    describe('Card placement', async () => {
        beforeEach(async () => {
            await db.dropDatabase()
        })
        it('Should place a card successfully', async () => {
            const {socket1, socket2} = await createAndJoin()
        })
        it('Should delete the card placed successfully')
        it('Should end the game when all cards are used')
        it('Should make a player lose after using all cards')
        it('Should make a player win after the other uses all cards')
    })
})