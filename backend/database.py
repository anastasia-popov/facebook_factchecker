from sqlalchemy import create_engine, Column, Integer, String, DateTime, Float, Boolean, Text, Date
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime, timedelta
from config import settings

DATABASE_URL = settings.database_url

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    # Google OAuth
    google_id = Column(String(255), unique=True, nullable=False, index=True)
    google_email = Column(String(255), unique=True, nullable=False, index=True)
    google_access_token = Column(String(1000), nullable=False)
    google_token_expiry = Column(DateTime, nullable=True)

    # Display name (from Google)
    display_name = Column(String(255), nullable=True)

    jwt_refresh_token = Column(String(500), unique=True, nullable=False, index=True)
    jwt_refresh_token_expiry = Column(DateTime, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_login = Column(DateTime, default=datetime.utcnow, nullable=False)

    quotas_monthly_requests = Column(Integer, default=5000, nullable=False)
    quotas_daily_requests = Column(Integer, default=200, nullable=False)
    quotas_monthly_reset_date = Column(Date, nullable=True)

    active = Column(Boolean, default=True, nullable=False)

    def __repr__(self):
        return f"<User({self.google_email})>"


class UsageTracking(Base):
    __tablename__ = "usage_tracking"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    endpoint = Column(String(255), nullable=False)
    request_timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    response_time_ms = Column(Integer, nullable=True)
    status_code = Column(Integer, nullable=True)
    tokens_used = Column(Integer, default=1, nullable=False)

    def __repr__(self):
        return f"<UsageTracking(user_id={self.user_id}, endpoint={self.endpoint})>"


class RateLimitBucket(Base):
    __tablename__ = "rate_limit_buckets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, unique=True, nullable=False, index=True)
    requests_today = Column(Integer, default=0, nullable=False)
    requests_today_reset = Column(DateTime, default=datetime.utcnow, nullable=False)
    requests_this_month = Column(Integer, default=0, nullable=False)
    requests_month_reset = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<RateLimitBucket(user_id={self.user_id})>"


def init_db():
    """Initialize database tables"""
    Base.metadata.create_all(bind=engine)


def get_db():
    """Dependency to get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
