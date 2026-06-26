from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from database import User, UsageTracking, RateLimitBucket
import logging

logger = logging.getLogger(__name__)


class RateLimiter:
    """Token bucket rate limiter for user API requests"""

    def __init__(self, daily_quota: int = 200, monthly_quota: int = 5000):
        self.daily_quota = daily_quota
        self.monthly_quota = monthly_quota

    def check_and_record_usage(
        self,
        user: User,
        endpoint: str,
        tokens_required: int = 1,
        db: Session = None
    ) -> tuple[bool, dict]:
        """
        Check if user can make request and record usage

        Returns:
            (allowed: bool, quota_info: dict)
        """
        if not db:
            return False, {"error": "Database session required"}

        # Get or create rate limit bucket
        bucket = db.query(RateLimitBucket).filter(
            RateLimitBucket.user_id == user.id
        ).first()

        if not bucket:
            bucket = RateLimitBucket(
                user_id=user.id,
                requests_today=0,
                requests_today_reset=datetime.utcnow(),
                requests_this_month=0,
                requests_month_reset=datetime.utcnow()
            )
            db.add(bucket)
            db.commit()
            db.refresh(bucket)

        # Reset daily counter if needed
        if self._should_reset_daily(bucket):
            bucket.requests_today = 0
            bucket.requests_today_reset = datetime.utcnow()

        # Reset monthly counter if needed
        if self._should_reset_monthly(bucket):
            bucket.requests_this_month = 0
            bucket.requests_month_reset = datetime.utcnow()

        # Check limits
        daily_remaining = self.daily_quota - bucket.requests_today
        monthly_remaining = self.monthly_quota - bucket.requests_this_month

        allowed = (
            (bucket.requests_today + tokens_required <= self.daily_quota) and
            (bucket.requests_this_month + tokens_required <= self.monthly_quota)
        )

        quota_info = {
            'daily_limit': self.daily_quota,
            'daily_used': bucket.requests_today,
            'daily_remaining': max(0, daily_remaining),
            'monthly_limit': self.monthly_quota,
            'monthly_used': bucket.requests_this_month,
            'monthly_remaining': max(0, monthly_remaining),
            'allowed': allowed,
            'tokens_required': tokens_required
        }

        if allowed:
            # Record usage
            bucket.requests_today += tokens_required
            bucket.requests_this_month += tokens_required
            db.commit()

            # Log to usage tracking
            usage = UsageTracking(
                user_id=user.id,
                endpoint=endpoint,
                tokens_used=tokens_required
            )
            db.add(usage)
            db.commit()

            logger.info(
                f"User {user.github_username} made request to {endpoint} "
                f"(daily: {bucket.requests_today}/{self.daily_quota}, "
                f"monthly: {bucket.requests_this_month}/{self.monthly_quota})"
            )
        else:
            logger.warning(
                f"User {user.github_username} exceeded rate limit on {endpoint} "
                f"(daily: {bucket.requests_today}/{self.daily_quota}, "
                f"monthly: {bucket.requests_this_month}/{self.monthly_quota})"
            )

        return allowed, quota_info

    def get_quota_info(self, user: User, db: Session) -> dict:
        """Get current quota information for user"""
        bucket = db.query(RateLimitBucket).filter(
            RateLimitBucket.user_id == user.id
        ).first()

        if not bucket:
            return {
                'daily_limit': self.daily_quota,
                'daily_used': 0,
                'daily_remaining': self.daily_quota,
                'monthly_limit': self.monthly_quota,
                'monthly_used': 0,
                'monthly_remaining': self.monthly_quota
            }

        # Reset if needed
        if self._should_reset_daily(bucket):
            bucket.requests_today = 0
            bucket.requests_today_reset = datetime.utcnow()

        if self._should_reset_monthly(bucket):
            bucket.requests_this_month = 0
            bucket.requests_month_reset = datetime.utcnow()

        db.commit()

        return {
            'daily_limit': self.daily_quota,
            'daily_used': bucket.requests_today,
            'daily_remaining': max(0, self.daily_quota - bucket.requests_today),
            'monthly_limit': self.monthly_quota,
            'monthly_used': bucket.requests_this_month,
            'monthly_remaining': max(0, self.monthly_quota - bucket.requests_this_month),
            'last_request': self._get_last_request(user, db),
            'last_reset': bucket.requests_today_reset
        }

    @staticmethod
    def _should_reset_daily(bucket: RateLimitBucket) -> bool:
        """Check if daily counter should reset (24 hours passed)"""
        return datetime.utcnow() - bucket.requests_today_reset >= timedelta(days=1)

    @staticmethod
    def _should_reset_monthly(bucket: RateLimitBucket) -> bool:
        """Check if monthly counter should reset (30 days passed)"""
        return datetime.utcnow() - bucket.requests_month_reset >= timedelta(days=30)

    @staticmethod
    def _get_last_request(user: User, db: Session):
        """Get timestamp of user's last request"""
        last_usage = db.query(UsageTracking).filter(
            UsageTracking.user_id == user.id
        ).order_by(UsageTracking.request_timestamp.desc()).first()

        return last_usage.request_timestamp if last_usage else None


# Initialize rate limiter
rate_limiter = RateLimiter(daily_quota=200, monthly_quota=5000)
