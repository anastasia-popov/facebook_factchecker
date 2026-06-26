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


class OAuth2Manager:
    """Manage OAuth 2.0 flow with GitHub"""

    def __init__(self):
        self.client_id = settings.github_oauth_client_id
        self.client_secret = settings.github_oauth_client_secret
        self.authorize_url = "https://github.com/login/oauth/authorize"
        self.token_url = "https://github.com/login/oauth/access_token"
        self.user_url = "https://api.github.com/user"

    def generate_pkce_pair(self) -> Tuple[str, str]:
        """Generate PKCE code_verifier and code_challenge"""
        # Generate 128-character random string
        code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(96)).decode('utf-8')
        code_verifier = code_verifier.rstrip('=')

        # Create challenge from verifier
        code_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(code_verifier.encode('utf-8')).digest()
        ).decode('utf-8').rstrip('=')

        return code_verifier, code_challenge

    def generate_state(self) -> str:
        """Generate random state parameter for CSRF protection"""
        return secrets.token_urlsafe(32)

    def get_authorization_url(self, state: str, code_challenge: str) -> str:
        """Get GitHub authorization URL with PKCE"""
        params = {
            'client_id': self.client_id,
            'redirect_uri': f'{settings.backend_url}/auth/callback',
            'scope': 'read:user',
            'state': state,
            'code_challenge': code_challenge,
            'code_challenge_method': 'S256'
        }

        query_string = '&'.join(f'{k}={v}' for k, v in params.items())
        return f'{self.authorize_url}?{query_string}'

    async def exchange_code_for_token(self, code: str, code_verifier: str) -> Dict:
        """Exchange authorization code for GitHub access token"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.token_url,
                data={
                    'client_id': self.client_id,
                    'client_secret': self.client_secret,
                    'code': code,
                    'code_verifier': code_verifier,
                    'redirect_uri': f'{settings.backend_url}/auth/callback',
                },
                headers={'Accept': 'application/json'}
            )

        if response.status_code != 200:
            logger.error(f"OAuth token exchange failed: {response.text}")
            raise Exception("Failed to exchange authorization code for token")

        data = response.json()
        if 'error' in data:
            raise Exception(f"OAuth error: {data['error_description']}")

        return data

    async def get_user_info(self, access_token: str) -> Dict:
        """Get authenticated user info from GitHub"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                self.user_url,
                headers={'Authorization': f'token {access_token}'}
            )

        if response.status_code != 200:
            logger.error(f"Failed to get user info: {response.text}")
            raise Exception("Failed to get user info from GitHub")

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
    def create_or_update_user(
        github_id: int,
        github_username: str,
        github_access_token: str,
        jwt_refresh_token: str,
        db: SessionLocal
    ) -> User:
        """Create or update user from OAuth response"""
        user = db.query(User).filter(User.github_id == github_id).first()

        refresh_token_expiry = datetime.utcnow() + timedelta(
            days=settings.refresh_token_expiration_days
        )

        if user:
            # Update existing user
            user.github_access_token = github_access_token
            user.github_username = github_username
            user.jwt_refresh_token = jwt_refresh_token
            user.jwt_refresh_token_expiry = refresh_token_expiry
            user.last_login = datetime.utcnow()
            user.active = True
        else:
            # Create new user
            user = User(
                github_id=github_id,
                github_username=github_username,
                github_access_token=github_access_token,
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
    def get_user_by_id(user_id: int, db: SessionLocal) -> Optional[User]:
        """Get user by ID"""
        return db.query(User).filter(User.id == user_id).first()

    @staticmethod
    def get_user_by_github_id(github_id: int, db: SessionLocal) -> Optional[User]:
        """Get user by GitHub ID"""
        return db.query(User).filter(User.github_id == github_id).first()

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
oauth_manager = OAuth2Manager()
jwt_manager = JWTManager()
