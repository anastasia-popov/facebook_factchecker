import os
import secrets
import hashlib
import base64
from datetime import datetime, timedelta
from typing import Optional, Dict, Tuple
import httpx
from jose import JWTError, jwt
from passlib.context import CryptContext
from config import settings
from database import User, SessionLocal
import logging

logger = logging.getLogger(__name__)

# Password context (for future use if needed)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class GoogleOAuth2Manager:
    """Manage OAuth 2.0 flow with Google"""

    def __init__(self):
        self.client_id = settings.google_oauth_client_id
        self.client_secret = settings.google_oauth_client_secret
        self.authorize_url = "https://accounts.google.com/o/oauth2/v2/auth"
        self.token_url = "https://oauth2.googleapis.com/token"
        self.user_url = "https://www.googleapis.com/oauth2/v2/userinfo"

    def generate_state(self) -> str:
        """Generate random state parameter for CSRF protection"""
        return secrets.token_urlsafe(32)

    def get_authorization_url(self, state: str) -> str:
        """Get Google authorization URL"""
        params = {
            'client_id': self.client_id,
            'redirect_uri': f'{settings.backend_url}/auth/google/callback',
            'scope': 'openid email profile',
            'response_type': 'code',
            'state': state
        }

        query_string = '&'.join(f'{k}={v}' for k, v in params.items())
        return f'{self.authorize_url}?{query_string}'

    async def exchange_code_for_token(self, code: str) -> Dict:
        """Exchange authorization code for Google access token"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.token_url,
                data={
                    'client_id': self.client_id,
                    'client_secret': self.client_secret,
                    'code': code,
                    'grant_type': 'authorization_code',
                    'redirect_uri': f'{settings.backend_url}/auth/google/callback',
                }
            )

        if response.status_code != 200:
            logger.error(f"Google token exchange failed: {response.text}")
            raise Exception("Failed to exchange authorization code for token")

        data = response.json()
        if 'error' in data:
            raise Exception(f"OAuth error: {data.get('error_description', 'Unknown error')}")

        return data

    async def get_user_info(self, access_token: str) -> Dict:
        """Get authenticated user info from Google"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                self.user_url,
                headers={'Authorization': f'Bearer {access_token}'}
            )

        if response.status_code != 200:
            logger.error(f"Failed to get user info: {response.text}")
            raise Exception("Failed to get user info from Google")

        return response.json()


class JWTManager:
    """Manage JWT token generation and validation"""

    def __init__(self):
        self.secret_key = settings.jwt_secret_key
        self.algorithm = settings.jwt_algorithm
        self.access_token_expire_minutes = settings.jwt_expiration_minutes
        self.refresh_token_expire_days = settings.refresh_token_expiration_days

    def create_access_token(self, user_id: int, github_username: str) -> str:
        """Create JWT access token"""
        expire = datetime.utcnow() + timedelta(minutes=self.access_token_expire_minutes)
        to_encode = {
            'sub': str(user_id),
            'username': github_username,
            'exp': expire,
            'iat': datetime.utcnow()
        }
        encoded_jwt = jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)
        return encoded_jwt

    def create_refresh_token(self) -> str:
        """Create refresh token (random string)"""
        return secrets.token_urlsafe(64)

    def verify_token(self, token: str) -> Optional[Dict]:
        """Verify and decode JWT token"""
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])
            user_id: str = payload.get("sub")
            if user_id is None:
                return None
            return payload
        except JWTError:
            return None

    def decode_token_without_verification(self, token: str) -> Optional[Dict]:
        """Decode token without verification (for debugging)"""
        try:
            payload = jwt.decode(
                token,
                self.secret_key,
                algorithms=[self.algorithm],
                options={"verify_signature": False}
            )
            return payload
        except JWTError:
            return None


class UserManager:
    """Manage user creation and updates"""

    @staticmethod
    def get_user_by_id(user_id: int, db: SessionLocal) -> Optional[User]:
        """Get user by ID"""
        return db.query(User).filter(User.id == user_id).first()

    @staticmethod
    def get_user_by_google_id(google_id: str, db: SessionLocal) -> Optional[User]:
        """Get user by Google ID"""
        return db.query(User).filter(User.google_id == google_id).first()

    @staticmethod
    def create_or_update_user(
        google_id: str,
        google_email: str,
        display_name: str,
        google_access_token: str,
        jwt_refresh_token: str,
        db: SessionLocal
    ) -> User:
        """Create or update user from Google OAuth response"""
        user = db.query(User).filter(User.google_id == google_id).first()

        refresh_token_expiry = datetime.utcnow() + timedelta(
            days=settings.refresh_token_expiration_days
        )

        if user:
            # Update existing user
            user.google_access_token = google_access_token
            user.google_email = google_email
            user.display_name = display_name
            user.jwt_refresh_token = jwt_refresh_token
            user.jwt_refresh_token_expiry = refresh_token_expiry
            user.last_login = datetime.utcnow()
            user.active = True
        else:
            # Create new user
            user = User(
                google_id=google_id,
                google_email=google_email,
                display_name=display_name,
                google_access_token=google_access_token,
                jwt_refresh_token=jwt_refresh_token,
                jwt_refresh_token_expiry=refresh_token_expiry,
                last_login=datetime.utcnow(),
                active=True
            )
            db.add(user)

        db.commit()
        db.refresh(user)
        return user

    @staticmethod
    def validate_refresh_token(user: User, refresh_token: str) -> bool:
        """Validate refresh token for a user"""
        if user.jwt_refresh_token != refresh_token:
            return False

        if user.jwt_refresh_token_expiry < datetime.utcnow():
            return False

        return True

    @staticmethod
    def refresh_user_token(user: User, new_refresh_token: str, db: SessionLocal) -> User:
        """Generate new refresh token for user"""
        user.jwt_refresh_token = new_refresh_token
        user.jwt_refresh_token_expiry = datetime.utcnow() + timedelta(
            days=settings.refresh_token_expiration_days
        )
        db.commit()
        db.refresh(user)
        return user

    @staticmethod
    def logout_user(user: User, db: SessionLocal) -> None:
        """Logout user by invalidating refresh token"""
        user.jwt_refresh_token = ""
        user.jwt_refresh_token_expiry = datetime.utcnow()
        db.commit()


# Initialize managers
google_oauth_manager = GoogleOAuth2Manager()
jwt_manager = JWTManager()
