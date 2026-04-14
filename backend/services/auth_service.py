"""
auth_service.py — Firebase Authentication & OTP Services
=========================================================
Handles custom OTP generation, Firestore integration, and validation.
"""
import os
import random
import time
import logging
import firebase_admin
from firebase_admin import credentials, firestore

logger = logging.getLogger("app.auth")

_db = None

def init_firebase():
    global _db
    if not firebase_admin._apps:
        # Resolve path to serviceAccountKey.json in the project root
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
        key_path = os.path.join(root_dir, 'serviceAccountKey.json')
        
        try:
            if not os.path.exists(key_path):
                logger.warning(f"serviceAccountKey.json not found at {key_path}")
            else:
                cred = credentials.Certificate(key_path)
                firebase_admin.initializeApp(cred)
                _db = firestore.client()
                logger.info("Firebase Admin initialized successfully.")
        except Exception as e:
            logger.error(f"Failed to initialize Firebase Admin: {e}")
            _db = None
    else:
        _db = firestore.client()
    return _db

def get_db():
    global _db
    if _db is None:
        init_firebase()
    return _db

def verify_jwt_token(id_token):
    """
    Verifies a Firebase JWT token sent from the frontend.
    Returns the decoded token dictionary (which includes 'phone_number', 'uid', etc.)
    if valid. Otherwise, raises an exception.
    """
    if not _db:
        init_firebase()
    
    if not firebase_admin._apps:
        raise Exception("Firebase not initialized")
        
    try:
        from firebase_admin import auth
        decoded_token = auth.verify_id_token(id_token)
        logger.info(f"Successfully verified user token for UID: {decoded_token.get('uid')}")
        return decoded_token
    except Exception as e:
        logger.error(f"Failed to verify JWT token: {str(e)}")
        raise ValueError("Invalid or expired authentication token")
