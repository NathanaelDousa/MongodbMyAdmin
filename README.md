
![MongodbAdminLogo](https://github.com/user-attachments/assets/878b877d-d4e2-44a6-963c-565df015f22f)

A modern, lightweight alternative to MongoDB Compass.  
Manage your MongoDB clusters, collections, and documents directly from a clean web interface.  
Built with **Laravel** (API backend) and **React + Vite** (frontend).

---

## Features

- 🔌 Connect to MongoDB via Driver or Atlas Data API  
- 📂 Browse and manage collections  
- 📄 Create, edit, clone, and delete documents  
- 🔗 Draw relations between documents visually (Canvas mode)  
- 🎨 Customizable preferences:
  - Light/Dark theme
  - Default view (List / Canvas)
  - Canvas grid gap
- 🛠 Developer-friendly setup with `make` commands

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (>=18)
- [Composer](https://getcomposer.org/)
- [PHP](https://www.php.net/) (>=8.1)
- [Make](https://www.gnu.org/software/make/) (usually preinstalled on macOS/Linux)

## Installation

Clone the repo and install dependencies:

```bash
git clone https://github.com/NathanaelDousa/MongodbMyAdmin
cd MongodbMyAdmin
make install
```
## Development

Start both backend (Laravel) and frontend (Vite):
```bash
make dev
```
this will run:
- Backend (Laravel) → http://127.0.0.1:8000
- Frontend (Vite) → http://localhost:5173

Logs are stored in .logs/.
PIDs are tracked in .pids/.

Stop servers cleanly with:
```bash
make stop
```
## Build for production
```bash
make build
```
## Make Commands
| Command                     | Description                                                        |
|-----------------------------|--------------------------------------------------------------------|
| `make install`               | Install dependencies (composer + npm) |
| `make dev`       | Run backend + frontend with logs and PID tracking. |
| `make stop`     | Stop backend and frontend processes. |
| `make restart` | Stop and immediately restart both servers. |
| `make backend `         | Run only the Laravel backend. |
| `make frontend`     | Run only the Vite frontend. |
| `make build`   | Build frontend for production. |
| `make backend-key`| Generate Laravel app key. |
| `make migrate`| Run Laravel migrations. |
| `make fresh`| Fresh migrate with seeding. |
| `make seed`| Seed the database. |
| `make status`| Show running PIDs and open ports. |
| `make logs`| Tail both backend and frontend logs. |
| `make clean-logs`| Clear stored log files. |



## Screenshots
Setup:
![steup-mongodbmyadmin](https://github.com/user-attachments/assets/4823fdfa-cd06-4d17-8673-b37190d0da66)

List view:
<img width="1445" height="496" alt="List" src="https://github.com/user-attachments/assets/665c8dc6-d203-4052-8886-a6ed025903fb" />

Canvas view:
<img width="1154" height="870" alt="Canvas" src="https://github.com/user-attachments/assets/31bddebd-3eda-4b1e-a0a5-b8576c131099" />


Settings modal:
![settings-profile](https://github.com/user-attachments/assets/7bddafec-5fb6-4b64-8a15-41fe98224017)

## Settings
- Profiles: Manage connection profiles (edit, delete, test)
- App: Theme, default view, grid spacing
- Database: Create, rename, drop collections

## 🤝 Contributing

Pull requests are welcome!
For major changes, please open an issue first to discuss what you would like to change.

## 📄 License

This project is licensed under the MIT License – see the [LICENSE](./LICENSE) file for details.
