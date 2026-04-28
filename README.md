<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 📘 Smart Civic Issue Reporting and Management System

A full-stack web application that enables citizens to report civic issues such as potholes, garbage overflow, drainage problems, and streetlight failures. The system allows administrators to manage, assign, and resolve complaints efficiently with real-time tracking and community verification.

---

## 🚀 Features

### 👤 Citizen Portal
- User registration and login (JWT authentication)
- Set location manually and view on map
- Report issues with image upload
- Select category (Garbage, Road Damage, Drainage, etc.)
- Track complaint status:
  - Pending → Assigned → In Progress → Resolved
- Verify resolution:
  - "Resolved" or "Not Resolved"
  - Upload proof image if not resolved
- View community issues and voting

### 🛠️ Admin Portal
- View all reported issues
- Assign issues to teams
- Update issue status
- Upload resolution images
- Manage workflow of complaints

### 🌐 System Features
- Map-based location visualization
- Role-based access (Citizen/Admin)
- Real-time updates
- Clean and responsive UI
- Image upload support

---

## 🧱 Tech Stack

### Frontend
- React.js
- Tailwind CSS / CSS
- Leaflet.js (Map)

### Backend
- Node.js
- Express.js
- JWT Authentication
- Multer (Image Upload)

### Database
- MongoDB

---

## 📂 Project Structure

```
root/
 ├── frontend/
 │    ├── src/
 │    ├── public/
 │    └── package.json
 │
 ├── backend/
 │    ├── controllers/
 │    ├── models/
 │    ├── routes/
 │    ├── uploads/
 │    ├── server.js
 │    └── package.json
 │
 ├── README.md
 └── .env
```

---

## ⚙️ Setup Instructions

### 1️⃣ Clone Repository
```bash
git clone https://github.com/your-username/civic-issue-system.git
cd civic-issue-system
```

---

## 🔧 Backend Setup

### Install dependencies
```bash
cd backend
npm install
```

### Create `.env` file
```
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_secret_key
```

### Run backend
```bash
npm run dev
```

Backend runs at:
```
http://localhost:5000
```

---

## 💻 Frontend Setup

### Install dependencies
```bash
cd frontend
npm install
```

### Run frontend
```bash
npm run dev
```

Frontend runs at:
```
http://localhost:3000
```

---

## 🔗 Connect Frontend to Backend

Create `.env` in frontend:

```
VITE_API_URL=http://localhost:3000
```

---

## 📸 Screenshots

You can add screenshots here:
- Login / Register
- Dashboard
- Report Issue
- Map View
- My Reports
- Admin Dashboard
- Issue Management

---

## 📑 License

This project is open-source and free to use.

---


- Your Name
