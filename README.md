# Jewellery Manufacturing Internal Tool

A comprehensive web-based system for managing the entire jewellery manufacturing workflow.

## Features

- **Amazon & eBay Integration** - Automatic order fetching via SP-API and eBay Sell API
- **CAD Workflow** - Assignment, upload, version control, and review process
- **Component Management** - Track gold, diamonds, gemstones, and other materials
- **Manufacturing Tracking** - Job assignment and status updates
- **Delivery Management** - Hand delivery and courier tracking
- **WhatsApp & Email Notifications** - Automated alerts at every stage
- **TAT Breach Monitoring** - Automatic alerts when deadlines are missed
- **Multi-Role Support** - Super Admin, Admin, CAD Designer, Manufacturer
- **Dual-Role Users** - Assign multiple roles to one user

## Tech Stack

- **Backend:** Node.js, Express.js, MongoDB
- **Frontend:** React.js with AdminLTE theme
- **Authentication:** JWT tokens
- **Notifications:** WhatsApp API + Nodemailer

## Project Structure

```
├── backend/
│   ├── src/
│   │   ├── controllers/     # Route controllers
│   │   ├── models/          # MongoDB schemas
│   │   ├── routes/          # API routes
│   │   ├── middleware/      # Auth, upload middleware
│   │   ├── services/        # Amazon, eBay, notifications
│   │   ├── cron/            # Scheduled jobs
│   │   ├── seeds/           # Database seeding
│   │   └── server.js        # Entry point
│   ├── uploads/             # File storage
│   ├── .env                 # Environment config
│   └── package.json
│
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/      # Reusable components
│   │   ├── context/         # React context (Auth)
│   │   ├── pages/           # Page components
│   │   ├── services/        # API service
│   │   ├── App.js           # Main app
│   │   └── index.js         # Entry point
│   └── package.json
│
├── TEST_CASES.md            # Test cases document
└── README.md
```

## Setup Instructions

### Prerequisites

- Node.js v18+
- MongoDB (local or Atlas)
- npm or yarn

### Backend Setup

1. Navigate to backend folder:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables in `.env`:
   ```
   MONGODB_URI=mongodb://localhost:27017/cataleon_db
   JWT_SECRET=your_secret_key
   ```

4. Start the server:
   ```bash
   npm run dev
   ```

   Server runs on http://localhost:5000

### Frontend Setup

1. Navigate to frontend folder:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```

   App runs on http://localhost:3000

## Default Login

- **Email:** admin@jewellery.com
- **Password:** Admin@123

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout
- `PUT /api/auth/change-password` - Change password

### Users
- `GET /api/users` - List users
- `POST /api/users` - Create user
- `PUT /api/users/:id` - Update user
- `PUT /api/users/:id/roles` - Assign roles

### Jobs
- `GET /api/jobs` - List jobs
- `POST /api/jobs` - Create job
- `GET /api/jobs/:id` - Get job details
- `PUT /api/jobs/:id/status` - Update status

### Orders
- `GET /api/orders` - List orders
- `POST /api/orders/sync/amazon` - Sync Amazon orders
- `POST /api/orders/sync/ebay` - Sync eBay orders
- `POST /api/orders/manual` - Create manual order

### CAD
- `GET /api/cad/my-tasks` - My CAD tasks
- `POST /api/cad/:jobId/assign` - Assign CAD designer
- `POST /api/cad/:jobId/upload` - Upload files
- `POST /api/cad/:jobId/approve` - Approve CAD
- `POST /api/cad/:jobId/reject` - Reject CAD

### Components
- `GET /api/components` - List components
- `POST /api/components` - Create component
- `POST /api/components/job/:jobId/issue` - Issue to job

### Manufacturing
- `GET /api/manufacturing/my-jobs` - My jobs
- `POST /api/manufacturing/:jobId/assign` - Assign manufacturer
- `POST /api/manufacturing/:jobId/accept` - Accept job
- `POST /api/manufacturing/:jobId/start` - Start work

### Delivery
- `GET /api/delivery/pending` - Pending deliveries
- `POST /api/delivery/:jobId` - Create delivery
- `POST /api/delivery/:jobId/delivered` - Mark delivered

### Settings
- `GET /api/settings` - Get settings
- `PUT /api/settings/:key` - Update setting
- `POST /api/settings/api/:platform` - Save API credentials

## Cron Jobs

The system runs automatic background jobs:

1. **Order Sync** - Every 5 minutes
   - Fetches new orders from Amazon and eBay

2. **TAT Monitoring** - Every 30 minutes
   - Checks for CAD, Manufacturing, and Delivery breaches
   - Sends WhatsApp and Email alerts

3. **Daily Summary** - Every day at 9 AM
   - Sends summary report to admins

## User Roles

| Role | Permissions |
|------|-------------|
| Super Admin | Full system access, API configuration, user management |
| Admin | Job management, CAD review, component issue, manufacturing assignment |
| CAD Designer | View assigned tasks, upload CAD files, submit for review |
| Manufacturer | View assigned jobs, update status, upload production files |

## Workflow

1. **Order Import** → Amazon/eBay order fetched automatically
2. **Job Creation** → Each order item becomes a job
3. **CAD Assignment** → Admin assigns to designer
4. **CAD Upload** → Designer uploads STL/renders
5. **CAD Review** → Admin approves or rejects
6. **Component Issue** → Admin issues materials
7. **Manufacturing** → Assigned to manufacturer
8. **Production** → Manufacturer updates status
9. **Delivery** → Hand or courier delivery
10. **Complete** → Job marked as delivered

## License

Private - All Rights Reserved
