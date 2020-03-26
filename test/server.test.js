require('dotenv-safe').config()
const { GAME_CONTRACT, TRON_PRIVATE_KEY, TRON_PRIVATE_KEY_TWO, TRON_ADDRESS, TRON_ADDRESS_TWO } = process.env

const expect = require('chai').expect
const io = require('socket.io-client')
const TronGrid = require('trongrid')
const TronWeb = require('tronweb')
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

function asyncTimeout(time) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve()
        }, time)
    })
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

function registerUserWithCrypto(privateKey, userSocket) {
    return new Promise(async (resolve, reject) => {
        // Check if user exists already
        const foundUser = await db.collection('users').findOne({ privateKey })
        // Delete before adding it
        if (foundUser) {
            await db.collection('users').deleteOne({ privateKey })
        }
        userSocket.once('setup:login-complete', async () => {
            try {
                const user = await db.collection('users').findOne({ privateKey })
                expect(user).to.not.be.null
                resolve()
            } catch (e) {
                reject(e)
            }
        })
        userSocket.once('issue', e => {
            reject(e.msg)
        })
        userSocket.emit('setup:login-with-crypto-private-key', { privateKey })
    })
}

function loginUser(user) {
    return new Promise(async (resolve, reject) => {
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

function loginWithCrypto(privateKey) {
    return new Promise(async (resolve, reject) => {
        let data = { privateKey, }
        socket.emit('setup:login-with-crypto-private-key', data)
        socket.once('setup:login-complete', async res => {
            expect(res.response.msg).to.not.be.null
            resolve(res)
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

async function createAndJoinWithCrypto(cardsPlayer1, cardsPlayer2) {
    let socket1 = await socketAsync()
    let socket2 = await socketAsync()
    let game1 = {
        gameName: 'Example',
        gameType: 'Rounds',
        rounds: 9,
        moveTimer: 99,
        totalCardsPlayerOne: cardsPlayer1 || 9,
    }
    let game2 = {
        playerOne: socket1.id,
        playerTwo: socket2.id,
        gameName: game1.gameName,
        gameType: game1.gameType,
        rounds: game1.rounds,
        moveTimer: game1.moveTimer,
        totalCardsPlayerTwo: cardsPlayer2 || 9,
    }

    try {
        await registerUserWithCrypto(TRON_PRIVATE_KEY, socket1)
    } catch (e) {
        throw new Error(e)
    }
    try {
        await registerUserWithCrypto(TRON_PRIVATE_KEY_TWO, socket2)
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
        let response = await joinGame(game2, socket2)
        expect(response.roomId).to.not.be.null
        expect(response.playerOne).to.eq(socket1.id)
        expect(response.playerTwo).to.eq(socket2.id)
    } catch (e) {
        expect(e).to.be.null
    }
    return { socket1, socket2 }
}

async function createAndJoin(cardsPlayer1, cardsPlayer2) {
    let socket1 = await socketAsync()
    let socket2 = await socketAsync()
    let game1 = {
        gameName: 'Example',
        gameType: 'Rounds',
        rounds: 9,
        moveTimer: 99,
        totalCardsPlayerOne: cardsPlayer1 || 9,
    }
    let game2 = {
        playerOne: socket1.id,
        playerTwo: socket2.id,
        gameName: game1.gameName,
        gameType: game1.gameType,
        rounds: game1.rounds,
        moveTimer: game1.moveTimer,
        totalCardsPlayerTwo: cardsPlayer2 || 9,
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
    return { socket1, socket2 }
}

// Emits and events and waits for another
function emitAndWait(socket, emitted, dataToEmit, waitName) {
    return new Promise((resolve, reject) => {
        socket.once(waitName, res => {
            resolve(res)
        })
        socket.once('issue', res => {
            reject(res)
        })
        socket.emit(emitted, dataToEmit)
    })
}

function placeCard(socket, data) {
    return new Promise((resolve, reject) => {
        socket.once('game:card-placement-done', async msg => {
            resolve(msg)
        })
        socket.emit('game:card-placed', data)
        socket.once('issue', async msg => {
            console.log('Issue 2', msg)
            reject(msg)
        })
    })
}

function waitRound(socket1, socket2, data1, data2) {
    return new Promise(async (resolve, reject) => {
        socket1.once('game:round:draw', async msg => {
            resolve({
                socket: 'one',
                event: 'game:round:draw',
                response: msg,
            })
        })
        socket1.once('game:round:winner-one', async msg => {
            resolve({
                socket: 'one',
                event: 'game:round:winner-two',
                response: msg,
            })
        })
        socket1.once('game:round:winner-two', async msg => {
            resolve({
                socket: 'one',
                event: 'game:round:winner-two',
                response: msg,
            })
        })
        socket2.once('game:round:draw', async msg => {
            resolve({
                socket: 'two',
                event: 'game:round:draw',
                response: msg,
            })
        })
        socket2.once('game:round:winner-one', async msg => {
            resolve({
                socket: 'two',
                event: 'game:round:winner-one',
                response: msg,
            })
        })
        socket2.once('game:round:winner-two', async msg => {
            resolve({
                socket: 'two',
                event: 'game:round:winner-two',
                response: msg,
            })
        })
        
        await placeCard(socket1, data1)
        await placeCard(socket2, data2)

        socket1.once('issue', e => {
            reject(e)
        })
        socket2.once('issue', e => {
            reject(e)
        })
    })
}

let lastRoomId = 0
describe('Server testing', async () => {
    before(async () => {
        client = new MongoClient(mongoUrl, {
            useUnifiedTopology: true,
        })
        await client.connect()
        db = client.db('roshambo')
        await asyncTimeout(3e3)
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
            try {
                await loginUser(user)
                expect(true).to.be.true
            } catch (e) {
                expect(true).to.be.false
            }
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
        it('Should register when clicking on login with crypto with a valid account', async () => {
            try {
                const response = await loginWithCrypto(TRON_PRIVATE_KEY)
                expect(response.response.msg).to.eq('New user created successfully')
            } catch (e) {
                expect(true).to.be.false
            }
        })
        it('Should login when clicking on login with crypto with an existing account', async () => {
            try {
                const response = await loginWithCrypto(TRON_PRIVATE_KEY)
                expect(response.response.msg).to.eq('New user created successfully')
            } catch (e) {
                expect(true).to.be.false
            }
            try {
                const response = await loginWithCrypto(TRON_PRIVATE_KEY)
                expect(response.response.msg).to.eq('User logged in successfully')
            } catch (e) {
                expect(true).to.be.false
            }
        })
    })

    describe('Game setup and purchasing', async () => {
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

            lastRoomId++
        })

        it('Should buy cards successfully given enough TRX', async () => {
            const socket1 = await socketAsync()
            const privateKey = TRON_PRIVATE_KEY
            const account = TRON_ADDRESS
            const user1 = {
                email: 'example@gmail.com',
                password: 'example',
                username: 'example',
            }
            const data1 = {
                cardsToBuy: 10,
                account,
                privateKey,
            }
            try {
                await registerUser(user1, socket1)
            } catch (e) {
                throw new Error(e)
            }
            socket1.emit('tron:buy-cards', data1)
            socket1.once('tron:buy-cards-complete', () => {
                expect(true).to.be.true
            })
        })
    })

    describe('Card placement', async () => {
        beforeEach(async () => {
            await db.dropDatabase()
        })
        it('Should place a card successfully', async () => {
            const {socket1, socket2} = await createAndJoinWithCrypto(10, 20)
            const data = {
                roomId: `room${lastRoomId}`,
                cardType: 'Rock',
                privateKey: TRON_PRIVATE_KEY,
                sender: TRON_ADDRESS,
            }
            socket1.emit('game:card-placed', data)
            socket1.once('issue', e => {
                expect(true).to.be.false
            })
            lastRoomId++
        })
        it('Should test a round, place both cards and win player 1 successfully', async () => {
            const { socket1, socket2 } = await createAndJoinWithCrypto()
            const data1 = {
                roomId: `room${lastRoomId}`,
                cardType: 'Scissors',
                privateKey: TRON_PRIVATE_KEY,
                sender: TRON_ADDRESS,
            }
            const data2 = {
                roomId: `room${lastRoomId}`,
                cardType: 'Paper',
                privateKey: TRON_PRIVATE_KEY_TWO,
                sender: TRON_ADDRESS_TWO,
            }

            try {
                const { socket, event, response } = await waitRound(socket1, socket2, data1, data2)
                expect(event).to.eq('game:round:winner-one')
            } catch (e) {
                expect(true).to.be.false
            }
            lastRoomId++
        })
        it('Should test a round, place both cards and win player 2 successfully', async () => {
            const { socket1, socket2 } = await createAndJoinWithCrypto()
            const data1 = {
                roomId: `room${lastRoomId}`,
                cardType: 'Rock',
                privateKey: TRON_PRIVATE_KEY,
                sender: TRON_ADDRESS,
            }
            const data2 = {
                roomId: `room${lastRoomId}`,
                cardType: 'Paper',
                privateKey: TRON_PRIVATE_KEY_TWO,
                sender: TRON_ADDRESS_TWO,
            }

            try {
                const { socket, event, response } = await waitRound(socket1, socket2, data1, data2)
                expect(event).to.eq('game:round:winner-two')
            } catch (e) {
                expect(true).to.be.false
            }
            lastRoomId++
        })
        it('Should test a round, place both cards and get a draw successfully', async () => {
            const { socket1, socket2 } = await createAndJoinWithCrypto()
            const data1 = {
                roomId: `room${lastRoomId}`,
                cardType: 'Rock',
                privateKey: TRON_PRIVATE_KEY,
                sender: TRON_ADDRESS,
            }
            const data2 = {
                roomId: `room${lastRoomId}`,
                cardType: 'Rock',
                privateKey: TRON_PRIVATE_KEY_TWO,
                sender: TRON_ADDRESS_TWO,
            }

            try {
                const { socket, event, response } = await waitRound(socket1, socket2, data1, data2)
                expect(event).to.eq('game:round:draw')
            } catch (e) {
                expect(true).to.be.false
            }
            lastRoomId++
        })
        // This test can't be executed because we can't constantly buy and sell cards
        // This is working anyway
        xit('Should delete the card placed successfully', async () => {
            // 1. Variables setup
            const { socket1, socket2 } = await createAndJoinWithCrypto()
            const privateKey = TRON_PRIVATE_KEY
            const sender = TRON_ADDRESS
            const data1 = {
                roomId: `room${lastRoomId}`,
                cardType: 'Paper',
                privateKey: TRON_PRIVATE_KEY,
                sender: TRON_ADDRESS,
            }

            // 2. Contract and trongrid setup
            const tronWeb = new TronWeb({
                fullNode: 'https://api.trongrid.io',
                solidityNode: 'https://api.trongrid.io',
                eventServer: 'https://api.trongrid.io',
                privateKey,
            })
            tronWeb.defaultAddress = {
                hex: tronWeb.address.toHex(sender),
                base58: sender,
            }
            const contractInstance = await tronWeb.contract().at(GAME_CONTRACT)

            // 3. Getting initial cards
            let initialCards = []
            let finalCards = []
            try {
              initialCards = await contractInstance.getMyCards().call({
                from: sender,
              })
            } catch (e) {
              console.log('Error getting your cards')
              expect(e).to.be.null
            }

            // 4. Executing the card placement
            try {
                await emitAndWait(socket1, 'game:card-placed', data1, 'game:card-placement-done')
            } catch (e) {
                console.log('Error', e)
                expect(e).to.be.null
            }

            // 5. Check if the card has been deleted
            try {
                finalCards = await contractInstance.getMyCards().call({
                    from: sender,
                })
                console.log('Final cards', finalCards)
                console.log('Initial cards', initialCards)
                process.exit(0)
            } catch (e) {
                console.log('Error getting your cards')
                expect(e).to.be.null
            }

            console.log('Initial cards', initialCards, 'final cards', finalCards)
            // 6. Final expect
            expect(initialCards.length).to.eq(finalCards.length + 1)

            // INFO This is the event that will be executed, check if the card is being deleted after
            // transaction = await contractInstance.deleteCard(data.cardType).send({
            //     from: data.sender,
            // })
            lastRoomId++
        })

        it('Should end a game successfully as a draw event after all 9 rounds', async () => {
            const {socket1, socket2} = await createAndJoinWithCrypto()
            const data1 = {
                roomId: `room${lastRoomId}`,
                cardType: 'Scissors',
                privateKey: TRON_PRIVATE_KEY,
                sender: TRON_ADDRESS,
            }
            const data2 = {
                roomId: `room${lastRoomId}`,
                cardType: 'Paper',
                privateKey: TRON_PRIVATE_KEY_TWO,
                sender: TRON_ADDRESS_TWO,
            }

            const data3 = {
                roomId: `room${lastRoomId}`,
                cardType: 'Rock',
                privateKey: TRON_PRIVATE_KEY,
                sender: TRON_ADDRESS,
            }
            const data4 = {
                roomId: `room${lastRoomId}`,
                cardType: 'Paper',
                privateKey: TRON_PRIVATE_KEY_TWO,
                sender: TRON_ADDRESS_TWO,
            }

            // Setup the game finishing events
            // This shouldn't be called
            socket1.once('game:finish:winner-player-one', () => {
                console.log('Winner 1')
                expect(true).to.be.false
            })
            // This shouldn't be called
            socket1.once('game:finish:winner-player-two', () => {
                console.log('Winner 2')
                expect(true).to.be.false
            })
            // This should be called after 9 rounds not sooner
            socket1.once('game:finish:draw', () => {
                console.log('Winner Draw')
                console.log('Called the draw event')
                expect(true).to.be.true
            })

            /**
             * Run the rounds without losing all the start
             * 
             */
            // console.log('Round 1')
            await placeCard(socket1, data1)
            await placeCard(socket2, data2)

            // console.log('Round 2')
            await placeCard(socket1, data3)
            await placeCard(socket2, data4)

            // console.log('Round 3')
            await placeCard(socket1, data1)
            await placeCard(socket2, data2)

            // console.log('Round 4')
            await placeCard(socket1, data3)
            await placeCard(socket2, data4)

            // console.log('Round 5')
            await placeCard(socket1, data1)
            await placeCard(socket2, data2)

            // console.log('Round 6')
            await placeCard(socket1, data3)
            await placeCard(socket2, data4)

            // console.log('Round 7')
            await placeCard(socket1, data1)
            await placeCard(socket2, data2)

            // console.log('Round 8')
            await placeCard(socket1, data3)
            await placeCard(socket2, data4)

            // console.log('Round 9')
            await placeCard(socket1, data1)
            await placeCard(socket2, data2)
            lastRoomId++
        })
        // The strategy is to emit all draw events until a player uses all cards 8 vs 9 cards
        xit('Should make player one lose after using all cards', async () => {
            const {socket1, socket2} = await createAndJoin(5)
            const data1 = {
                roomId: `room${lastRoomId}`,
                cardType: 'Scissors',
                privateKey,
                sender,
            }
            const data2 = {
                roomId: `room${lastRoomId}`,
                cardType: 'Scissors',
                privateKey,
                sender,
            }

            // Setup the game finishing events
            // This should be called
            socket1.once('game:finish:winner-player-one', () => {
                expect(true).to.be.true
            })
            // This shouldn't be called
            socket1.once('game:finish:winner-player-two', () => {
                expect(true).to.be.false
            })
            // This shouldn't be called
            socket1.once('game:finish:draw', () => {
                expect(true).to.be.false
            })

            // Set the 18 card placement among both players
            for (let i = 0; i < 18; i++) {
                if (i % 2 == 0) {
                    console.log('Round', i/2 + 1)
                    await placeCard(socket1, data1)
                } else {
                    await placeCard(socket2, data2)
                }
            }
            lastRoomId++
        })
        xit('Should make a player win after the other uses all his cards', async () => {
            const {socket1, socket2} = await createAndJoin(9, 5)
            const data1 = {
                roomId: `room${lastRoomId}`,
                cardType: 'Scissors',
                privateKey,
                sender,
            }
            const data2 = {
                roomId: `room${lastRoomId}`,
                cardType: 'Scissors',
                privateKey,
                sender,
            }

            // Setup the game finishing events
            // This shouldn't be called
            socket1.once('game:finish:winner-player-one', () => {
                expect(true).to.be.false
            })
            // This should be called
            socket1.once('game:finish:winner-player-two', () => {
                expect(true).to.be.true
            })
            // This shouldn't be called
            socket1.once('game:finish:draw', () => {
                expect(true).to.be.false
            })

            // Set the 18 card placement among both players
            for (let i = 0; i < 18; i++) {
                if (i % 2 == 0) {
                    console.log('Round', i/2 + 1)
                    await placeCard(socket1, data1)
                } else {
                    await placeCard(socket2, data2)
                }
            }
            lastRoomId++
        })
    })
})