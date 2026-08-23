# GO LESKA Backend API

FastAPI backend for GO LESKA - India's blue-collar workforce platform.

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```bash
cp .env.example .env
```

Get these from your Supabase project:
- `SUPABASE_URL`: Project URL from Supabase dashboard
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key (Settings → API Keys)
- `SUPABASE_ANON_KEY`: Anon key from frontend

### 3. Set up Database Schema

Run the SQL migrations in your Supabase project:

```bash
# Using Supabase CLI
supabase db push

# OR manually in Supabase SQL Editor:
# - Run supabase/migrations/001_create_schema.sql
# - Run supabase/migrations/002_enable_rls.sql
```

### 4. Run Backend

```bash
python -m uvicorn app.main:app --reload
```

Backend will be available at: `http://localhost:8000`

## API Documentation

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## API Endpoints

### Health
- `GET /health` - Health check

### Authentication
- `POST /api/v1/auth/request-otp` - Request OTP
- `POST /api/v1/auth/verify-otp` - Verify OTP and create account
- `POST /api/v1/auth/worker-register` - Initiate worker registration
- `POST /api/v1/auth/employer-register` - Initiate employer registration
- `GET /api/v1/auth/me` - Get current user
- `POST /api/v1/auth/logout` - Logout

### Workers
- `GET /api/v1/workers/me` - Get worker profile
- `PUT /api/v1/workers/me` - Update worker profile

### Employers
- `GET /api/v1/employers/me` - Get employer profile
- `GET /api/v1/employers/onboarding` - Get onboarding status
- `POST /api/v1/employers/onboarding/type` - Select employer type
- `PUT /api/v1/employers/onboarding/registered-industry` - Update registered industry details
- `PUT /api/v1/employers/onboarding/registered-business` - Update registered business details
- `PUT /api/v1/employers/onboarding/unregistered-business` - Update unregistered business details
- `PUT /api/v1/employers/onboarding/individual` - Update individual employer details
- `POST /api/v1/employers/onboarding/complete` - Complete onboarding

## Architecture

```
app/
├── main.py           # FastAPI app initialization
├── core/
│   ├── config.py     # Configuration and settings
│   ├── supabase.py   # Supabase client
│   └── security.py   # Authentication dependencies
├── schemas/
│   ├── auth.py       # Auth request/response schemas
│   ├── worker.py     # Worker schemas
│   └── employer.py   # Employer schemas
├── routers/
│   ├── health.py     # Health check endpoints
│   ├── auth.py       # Authentication endpoints
│   ├── workers.py    # Worker endpoints
│   └── employers.py  # Employer endpoints
└── services/
    ├── auth_service.py           # Auth business logic
    ├── onboarding_service.py     # Onboarding logic
    └── user_service.py           # User operations
```

## Key Features

✓ Supabase authentication with OTP  
✓ Role-based access control (Worker, Employer, Admin)  
✓ Worker profile management  
✓ Multi-step employer onboarding  
✓ Type-specific employer validation  
✓ Row-level security on database  
✓ Comprehensive error handling  
✓ Swagger/ReDoc API documentation  

## Testing

```bash
# Run tests
pytest

# Run tests with coverage
pytest --cov=app
```

## Deployment

See the deployment guide (coming soon)
