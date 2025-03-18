// const mongoose = require("mongoose")
// const Document = require("./Document")

// mongoose.connect("mongodb://localhost:27017/", {
//   useNewUrlParser: true,
//   useUnifiedTopology: true,
//   useFindAndModify: false,
//   useCreateIndex: true,
// })

// const io = require("socket.io")(3001, {
//   cors: {
//     origin: "http://localhost:3000",
//     methods: ["GET", "POST"],
//   },
// })

// const defaultValue = ""

// io.on("connection", socket => {
//   socket.on("get-document", async documentId => {
//     const document = await findOrCreateDocument(documentId)
//     socket.join(documentId)
//     socket.emit("load-document", document.data)

//     socket.on("send-changes", delta => {
//       socket.broadcast.to(documentId).emit("receive-changes", delta)
//     })

//     socket.on("save-document", async data => {
//       await Document.findByIdAndUpdate(documentId, { data })
//     })
//   })
// })

// async function findOrCreateDocument(id) {
//   if (id == null) return

//   const document = await Document.findById(id)
//   if (document) return document
//   return await Document.create({ _id: id, data: defaultValue })
// }







require("dotenv").config()
const mongoose = require("mongoose")
const Document = require("./Document")

const PORT = process.env.PORT || 3001
const MONGODB_URI = process.env.MONGODB_URI
const CLIENT_URL = process.env.CLIENT_URL

// Connect to MongoDB
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ MongoDB connected"))
.catch((err) => console.error("❌ MongoDB connection error:", err))

// Initialize Socket.io server
const io = require("socket.io")(PORT, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
})

const defaultValue = ""

// Handle socket connection
io.on("connection", (socket) => {
  console.log(`🔌 New connection: ${socket.id}`)

  socket.on("get-document", async (documentId) => {
    try {
      const document = await findOrCreateDocument(documentId)
      socket.join(documentId)
      console.log(`📄 User joined document: ${documentId}`)

      socket.emit("load-document", document.data)

      socket.on("send-changes", (delta) => {
        socket.broadcast.to(documentId).emit("receive-changes", delta)
      })

      socket.on("save-document", async (data) => {
        try {
          await Document.findByIdAndUpdate(documentId, { data })
          console.log(`💾 Document ${documentId} saved`)
        } catch (err) {
          console.error(`❌ Error saving document ${documentId}:`, err)
        }
      })
    } catch (err) {
      console.error(`❌ Error loading document ${documentId}:`, err)
      socket.emit("error", { message: "Failed to load document" })
    }
  })

  // Cleanup on disconnect
  socket.on("disconnect", () => {
    console.log(`❌ Disconnected: ${socket.id}`)
  })
})

// Utility to find or create a document
async function findOrCreateDocument(id) {
  if (!id) return null

  try {
    const document = await Document.findById(id)
    if (document) return document

    return await Document.create({ _id: id, data: defaultValue })
  } catch (err) {
    console.error(`❌ Error finding/creating document:`, err)
    throw err
  }
}

console.log(`🚀 Server running on port ${PORT}`)
