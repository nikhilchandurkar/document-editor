
import { useCallback, useEffect, useState, useRef } from "react"
import Quill from "quill"
import "quill/dist/quill.snow.css"
import { io } from "socket.io-client"
import { useParams, useHistory } from "react-router-dom"
import QuillCursors from "quill-cursors"
import { debounce } from "lodash"
import { saveAs } from "file-saver" // For saving files
import { Document, Packer, Paragraph, TextRun } from "docx" // For DOCX generation
import { jsPDF } from "jspdf" // For PDF generation

// Register the cursors module
Quill.register("modules/cursors", QuillCursors)

const SAVE_INTERVAL_MS = 2000
const CURSOR_UPDATE_MS = 100
const TOOLBAR_OPTIONS = [
  [{ header: [1, 2, 3, 4, 5, 6, false] }],
  [{ font: [] }],
  [{ list: "ordered" }, { list: "bullet" }],
  ["bold", "italic", "underline", "strike"],
  [{ color: [] }, { background: [] }],
  [{ script: "sub" }, { script: "super" }],
  [{ align: [] }],
  ["image", "blockquote", "code-block", "link"],
  ["clean"],
]

export default function TextEditor() {
  const { id: documentId } = useParams()
  const [socket, setSocket] = useState()
  const [quill, setQuill] = useState()
  const [connected, setConnected] = useState(false)
  const [documentTitle, setDocumentTitle] = useState("Untitled Document")
  const [activeUsers, setActiveUsers] = useState([])
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [darkMode, setDarkMode] = useState(false)
  const history = useHistory()
  const cursorsRef = useRef(null)
  const userColorRef = useRef(getRandomColor())

  // Generate random user color for cursor
  function getRandomColor() {
    const colors = [
      "#FF6633", "#FFB399", "#FF33FF", "#FFFF99", "#00B3E6", 
      "#E6B333", "#3366E6", "#999966", "#99FF99", "#B34D4D",
      "#80B300", "#809900", "#E6B3B3", "#6680B3", "#66991A", 
      "#FF99E6", "#CCFF1A", "#FF1A66", "#E6331A", "#33FFCC",
    ]
    return colors[Math.floor(Math.random() * colors.length)]
  }

  // Generate user ID on component mount
  const userIdRef = useRef(`user-${Math.random().toString(36).substr(2, 9)}`)

  useEffect(() => {
    // Apply dark mode to document if enabled
    if (darkMode) {
      document.body.classList.add('dark-theme')
    } else {
      document.body.classList.remove('dark-theme')
    }
  }, [darkMode])

  useEffect(() => {
    const serverUrl = process.env.REACT_APP_SERVER_URL || "http://localhost:3001"
    const s = io(serverUrl)
    setSocket(s)

    // Socket connection events
    s.on("connect", () => {
      console.log("Connected to server")
      setConnected(true)
    })

    s.on("disconnect", () => {
      console.log("Disconnected from server")
      setConnected(false)
    })

    s.on("connect_error", (err) => {
      console.error("Connection error:", err)
      setConnected(false)
    })

    return () => {
      s.disconnect()
    }
  }, [])

  useEffect(() => {
    if (socket == null || quill == null) return

    // Handle document loading
    socket.once("load-document", ({ document, title, users }) => {
      quill.setContents(document)
      quill.enable()
      setDocumentTitle(title || "Untitled Document")
      setActiveUsers(users || [])
      
      // Initialize user in the document
      socket.emit("join-document", {
        documentId,
        userId: userIdRef.current,
        color: userColorRef.current
      })
    })

    socket.emit("get-document", documentId)
  }, [socket, quill, documentId])

  // Handle auto-saving
  useEffect(() => {
    if (socket == null || quill == null) return

    const interval = setInterval(() => {
      setSaving(true)
      socket.emit("save-document", {
        documentId,
        content: quill.getContents(),
        title: documentTitle
      }, () => {
        // Callback when save is acknowledged
        setSaving(false)
        setLastSaved(new Date())
      })
    }, SAVE_INTERVAL_MS)

    return () => {
      clearInterval(interval)
    }
  }, [socket, quill, documentId, documentTitle])

  // Handle receiving changes from server
  useEffect(() => {
    if (socket == null || quill == null) return

    const handler = delta => {
      quill.updateContents(delta)
    }
    socket.on("receive-changes", handler)

    return () => {
      socket.off("receive-changes", handler)
    }
  }, [socket, quill])

  // Handle sending changes to server
  useEffect(() => {
    if (socket == null || quill == null) return

    const handler = (delta, oldDelta, source) => {
      if (source !== "user") return
      socket.emit("send-changes", {
        delta,
        documentId
      })
    }
    quill.on("text-change", handler)

    return () => {
      quill.off("text-change", handler)
    }
  }, [socket, quill, documentId])

  // Handle cursor position updates
  useEffect(() => {
    if (socket == null || quill == null || !cursorsRef.current) return

    const updateCursorPosition = debounce(() => {
      const range = quill.getSelection()
      if (range) {
        socket.emit("cursor-position", {
          documentId,
          userId: userIdRef.current,
          range,
          color: userColorRef.current
        })
      }
    }, CURSOR_UPDATE_MS)

    // Update cursor position on selection-change event
    quill.on('selection-change', updateCursorPosition)

    // Handle cursor updates from other users
    socket.on("cursor-update", ({ userId, range, color }) => {
      if (userId !== userIdRef.current) {
        cursorsRef.current.createCursor(userId, userId, color)
        cursorsRef.current.moveCursor(userId, range)
      }
    })

    // Handle user join/leave events
    socket.on("user-joined", (users) => {
      setActiveUsers(users)
    })

    socket.on("user-left", (users) => {
      setActiveUsers(users)
      // Remove cursor for user who left
      users.forEach(user => {
        if (!users.find(u => u.id === user.id)) {
          cursorsRef.current.removeCursor(user.id)
        }
      })
    })

    return () => {
      quill.off('selection-change', updateCursorPosition)
      socket.off("cursor-update")
      socket.off("user-joined")
      socket.off("user-left")
    }
  }, [socket, quill, documentId])

  // Handle document title change
  const handleTitleChange = (e) => {
    setDocumentTitle(e.target.value)
  }

  // Manual save functionality
  const handleManualSave = () => {
    if (socket == null || quill == null) return
    setSaving(true)
    socket.emit("save-document", {
      documentId,
      content: quill.getContents(),
      title: documentTitle
    }, () => {
      setSaving(false)
      setLastSaved(new Date())
    })
  }

  // Export document as PDF
  const exportAsPDF = () => {
    if (!quill) return
    
    const doc = new jsPDF()
    const text = quill.getText()
    const title = documentTitle || 'Untitled Document'
    
    // Add title
    doc.setFontSize(16)
    doc.text(title, 20, 20)
    
    // Add content with word wrapping
    doc.setFontSize(12)
    const splitText = doc.splitTextToSize(text, 180)
    doc.text(splitText, 20, 30)
    
    // Save the PDF
    doc.save(`${title}.pdf`)
  }

  // Export document as DOCX
  const exportAsDOCX = () => {
    if (!quill) return
    
    // Create a new document
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: documentTitle || "Untitled Document",
                bold: true,
                size: 28
              })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: quill.getText() || ""
              })
            ]
          })
        ]
      }]
    })
    
    // Generate and save the DOCX file
    Packer.toBlob(doc).then(blob => {
      saveAs(blob, `${documentTitle || "Untitled Document"}.docx`)
    })
  }

  // Export document as HTML or plain text
  const exportDocument = (format) => {
    if (!quill) return
    
    let content = '';
    if (format === 'html') {
      content = quill.root.innerHTML
      download(`${documentTitle}.html`, content)
    } else if (format === 'text') {
      content = quill.getText()
      download(`${documentTitle}.txt`, content)
    } else if (format === 'json') {
      content = JSON.stringify(quill.getContents())
      download(`${documentTitle}.json`, content)
    } else if (format === 'pdf') {
      exportAsPDF()
    } else if (format === 'docx') {
      exportAsDOCX()
    }
  }

  // Helper function to download content
  const download = (filename, content) => {
    const element = document.createElement('a')
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content))
    element.setAttribute('download', filename)
    element.style.display = 'none'
    document.body.appendChild(element)
    element.click()
    document.body.removeChild(element)
  }

  // Navigate to a new document - using history and correct path
  const createNewDocument = () => {
    const newDocId = Math.random().toString(36).substring(2, 15)
    history.push(`/documents/${newDocId}`)
    // Reload the page to ensure a clean state for the new document
    window.location.reload()
  }

  // Toggle dark mode
  const toggleDarkMode = () => {
    setDarkMode(!darkMode)
  }

  // Initialize Quill editor
  const wrapperRef = useCallback(wrapper => {
    if (wrapper == null) return

    wrapper.innerHTML = ""
    const editor = document.createElement("div")
    wrapper.append(editor)
    
    const q = new Quill(editor, {
      theme: "snow",
      modules: { 
        toolbar: TOOLBAR_OPTIONS,
        cursors: {
          transformOnTextChange: true,
        }
      },
    })
    
    q.disable()
    q.setText("Loading...")
    setQuill(q)
    cursorsRef.current = q.getModule('cursors')
  }, [])

  // Format the last saved time
  const formatLastSaved = () => {
    if (!lastSaved) return "Not saved yet"
    
    return lastSaved.toLocaleTimeString()
  }

  return (
    <div className={`editor-container ${darkMode ? 'dark-mode' : ''}`}>
      <div className="toolbar-container">
        <div className="document-info">
          <input 
            type="text" 
            value={documentTitle} 
            onChange={handleTitleChange} 
            className="document-title"
            placeholder="Untitled Document"
          />
          <div className="document-status">
            {saving ? (
              <span className="saving-status">Saving...</span>
            ) : (
              <span className="saved-status">Last saved: {formatLastSaved()}</span>
            )}
          </div>
        </div>
        <div className="document-actions">
          <button onClick={handleManualSave} disabled={saving} className="action-button">
            {saving ? "Saving..." : "Save"}
          </button>
          <div className="dropdown">
            <button className="action-button dropdown-toggle">Export</button>
            <div className="dropdown-menu">
              <button onClick={() => exportDocument('html')} className="dropdown-item">HTML</button>
              <button onClick={() => exportDocument('text')} className="dropdown-item">Plain Text</button>
              <button onClick={() => exportDocument('json')} className="dropdown-item">JSON</button>
              <button onClick={() => exportDocument('pdf')} className="dropdown-item">PDF</button>
              <button onClick={() => exportDocument('docx')} className="dropdown-item">DOCX</button>
            </div>
          </div>
          <button onClick={createNewDocument} className="action-button">New Document</button>
          <button onClick={toggleDarkMode} className="action-button">
            {darkMode ? "Light Mode" : "Dark Mode"}
          </button>
        </div>
      </div>
      
      {!connected && (
        <div className="connection-status">
          <span className="disconnected">Disconnected from server. Trying to reconnect...</span>
        </div>
      )}
      
      <div className="active-users">
        {activeUsers.length > 0 && (
          <div className="users-container">
            <span className="users-label">Active users: </span>
            {activeUsers.map((user, index) => (
              <span key={user.id} className="user-indicator" style={{backgroundColor: user.color}}>
                {user.id.substring(0, 4)}
              </span>
            ))}
          </div>
        )}
      </div>
      
      <div className="editor-wrapper" ref={wrapperRef}></div>
      
      <style jsx>{`
        .editor-container {
          display: flex;
          flex-direction: column;
          height: 100vh;
          background-color: #f9f9f9;
          transition: background-color 0.3s;
        }
        
        .dark-mode {
          background-color: #2d2d2d;
          color: #eee;
        }
        
        .dark-mode .ql-toolbar,
        .dark-mode .ql-container {
          border-color: #444 !important;
          background-color: #333 !important;
          color: #eee !important;
        }
        
        .dark-mode .document-title,
        .dark-mode .action-button {
          background-color: #333;
          color: #eee;
          border-color: #555;
        }
        
        .toolbar-container {
          display: flex;
          justify-content: space-between;
          padding: 10px 20px;
          border-bottom: 1px solid #ddd;
          background-color: #fff;
          transition: background-color 0.3s;
        }
        
        .dark-mode .toolbar-container {
          background-color: #333;
          border-color: #444;
        }
        
        .document-info {
          display: flex;
          flex-direction: column;
        }
        
        .document-title {
          font-size: 18px;
          border: 1px solid transparent;
          border-radius: 4px;
          padding: 5px 10px;
          margin-bottom: 5px;
        }
        
        .document-title:focus {
          border-color: #ddd;
          outline: none;
        }
        
        .document-status {
          font-size: 12px;
          color: #666;
        }
        
        .dark-mode .document-status {
          color: #aaa;
        }
        
        .document-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .action-button {
          padding: 8px 12px;
          background: #fff;
          border: 1px solid #ddd;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        }
        
        .action-button:hover {
          background: #f0f0f0;
        }
        
        .dark-mode .action-button:hover {
          background: #444;
        }
        
        .dropdown {
          position: relative;
          display: inline-block;
        }
        
        .dropdown-menu {
          display: none;
          position: absolute;
          background-color: #fff;
          min-width: 120px;
          box-shadow: 0px 8px 16px 0px rgba(0,0,0,0.2);
          z-index: 1;
          border-radius: 4px;
          overflow: hidden;
        }
        
        .dark-mode .dropdown-menu {
          background-color: #333;
          box-shadow: 0px 8px 16px 0px rgba(0,0,0,0.5);
        }
        
        .dropdown:hover .dropdown-menu {
          display: block;
        }
        
        .dropdown-item {
          width: 100%;
          text-align: left;
          padding: 8px 12px;
          border: none;
          background: none;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        
        .dropdown-item:hover {
          background-color: #f5f5f5;
        }
        
        .dark-mode .dropdown-item {
          color: #eee;
        }
        
        .dark-mode .dropdown-item:hover {
          background-color: #444;
        }
        
        .connection-status {
          padding: 5px 10px;
          background-color: #ffebee;
          color: #d32f2f;
          text-align: center;
          font-size: 14px;
        }
        
        .dark-mode .connection-status {
          background-color: #4a1111;
          color: #ff8a8a;
        }
        
        .active-users {
          padding: 5px 20px;
          border-bottom: 1px solid #ddd;
          display: flex;
          flex-wrap: wrap;
        }
        
        .dark-mode .active-users {
          border-color: #444;
        }
        
        .users-container {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        
        .users-label {
          font-size: 14px;
          color: #666;
        }
        
        .dark-mode .users-label {
          color: #aaa;
        }
        
        .user-indicator {
          padding: 2px 6px;
          border-radius: 12px;
          color: white;
          font-size: 12px;
          font-weight: bold;
        }
        
        .editor-wrapper {
          flex-grow: 1;
        }
        
        .ql-container.ql-snow {
          border: none;
          font-size: 16px;
        }
        
        .ql-toolbar.ql-snow {
          border-top: none;
          border-left: none;
          border-right: none;
          border-bottom: 1px solid #ddd;
        }
        
        .container {
          height: 100%;
        }
      `}</style>
    </div>
  )
}