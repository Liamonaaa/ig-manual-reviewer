import json
import os
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

from flask import Flask, jsonify, request
from flask_cors import CORS
from instagrapi import Client
from instagrapi.exceptions import ChallengeError, FeedbackRequired, LoginRequired, RateLimitError

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STORE_DIR = os.path.join(BASE_DIR, "session_store")
CLIENT_STATE_DIR = os.path.join(STORE_DIR, "clients")
INSTAGRAM_SESSION_DIR = os.path.join(STORE_DIR, "instagram")
USER_ID_PREFETCH_LOOKAHEAD = 3
PREFETCH_IDLE_SLEEP_SECONDS = 0.1

for directory in (STORE_DIR, CLIENT_STATE_DIR, INSTAGRAM_SESSION_DIR):
    os.makedirs(directory, exist_ok=True)

app = Flask(__name__)
CORS(app)

CONTEXTS_LOCK = threading.RLock()
CONTEXTS_BY_CLIENT_ID: dict[str, "ClientSessionContext"] = {}


@dataclass
class ClientSessionContext:
    client_session_id: str
    instagram_username: Optional[str] = None
    pending_users: list[str] = field(default_factory=list)
    failed_users: list[dict] = field(default_factory=list)
    client: Optional[Client] = None
    authenticated: bool = False
    total_loaded_count: int = 0
    processed_count: int = 0
    current_username: Optional[str] = None
    last_processed_username: Optional[str] = None
    last_error: Optional[str] = None
    is_processing: bool = False
    stop_requested: bool = False
    resolved_user_ids: dict[str, int] = field(default_factory=dict, repr=False)
    worker: Optional[threading.Thread] = field(default=None, repr=False, compare=False)
    resolver: Optional[threading.Thread] = field(default=None, repr=False, compare=False)
    prefetching_usernames: set[str] = field(default_factory=set, repr=False, compare=False)
    last_active_at: float = field(default_factory=time.time)
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)


class VerificationCodeRequired(ValueError):
    pass


def create_instagram_client() -> Client:
    client = Client()
    client.delay_range = [0, 0]
    return client


def normalize_username(username: str) -> str:
    return username.strip().lstrip("@").lower()


def sanitize_username(username: str) -> str:
    return username.strip().lstrip("@")


def safe_path_component(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", value).strip("._")[:120] or "session"


def client_state_path(client_session_id: str) -> str:
    return os.path.join(CLIENT_STATE_DIR, f"{safe_path_component(client_session_id)}.json")


def instagram_session_path(instagram_username: str) -> str:
    normalized = normalize_username(instagram_username)
    return os.path.join(INSTAGRAM_SESSION_DIR, f"{safe_path_component(normalized)}.json")


def now_timestamp() -> int:
    return int(time.time())


def sanitize_usernames(usernames) -> list[str]:
    seen_usernames = set()
    sanitized_users = []

    for username in usernames:
        if not isinstance(username, str):
            continue

        sanitized = sanitize_username(username)
        normalized = normalize_username(sanitized)
        if not sanitized or normalized in seen_usernames:
            continue

        seen_usernames.add(normalized)
        sanitized_users.append(sanitized)

    return sanitized_users


def sanitize_failed_users(failed_users) -> list[dict]:
    if not isinstance(failed_users, list):
        return []

    deduped_users: dict[str, dict] = {}
    order: list[str] = []
    fallback_timestamp = now_timestamp()

    for failed_user in failed_users:
        if not isinstance(failed_user, dict):
            continue

        username = sanitize_username(str(failed_user.get("username", "")))
        normalized = normalize_username(username)
        if not username:
            continue

        reason = str(failed_user.get("reason") or failed_user.get("failureReason") or "Unknown unfollow error.")
        try:
            failed_at = int(failed_user.get("failedAt") or fallback_timestamp)
        except (TypeError, ValueError):
            failed_at = fallback_timestamp

        if normalized not in deduped_users:
            order.append(normalized)

        deduped_users[normalized] = {
            "username": username,
            "reason": reason,
            "failedAt": failed_at,
        }

    return [deduped_users[normalized] for normalized in order]


def sanitize_resolved_user_ids(resolved_user_ids) -> dict[str, int]:
    if not isinstance(resolved_user_ids, dict):
        return {}

    sanitized_ids: dict[str, int] = {}
    for username, user_id in resolved_user_ids.items():
        normalized = normalize_username(str(username))
        if not normalized:
            continue

        try:
            sanitized_ids[normalized] = int(user_id)
        except (TypeError, ValueError):
            continue

    return sanitized_ids


def load_context_from_disk(client_session_id: str) -> ClientSessionContext:
    path = client_state_path(client_session_id)
    if not os.path.exists(path):
        return ClientSessionContext(client_session_id=client_session_id)

    try:
        with open(path, "r", encoding="utf-8") as file:
            data = json.load(file)
    except (OSError, json.JSONDecodeError):
        return ClientSessionContext(client_session_id=client_session_id)

    pending_users = sanitize_usernames(data.get("pendingUsers", []))
    failed_users = sanitize_failed_users(data.get("failedUsers", []))
    resolved_user_ids = sanitize_resolved_user_ids(data.get("resolvedUserIds", {}))
    stored_total = int(data.get("totalLoadedCount", 0) or 0)
    stored_processed = int(data.get("processedCount", 0) or 0)
    total_loaded_count = max(stored_total, len(pending_users), stored_processed + len(pending_users))
    processed_count = min(stored_processed, total_loaded_count)

    return ClientSessionContext(
        client_session_id=client_session_id,
        instagram_username=data.get("instagramUsername"),
        pending_users=pending_users,
        failed_users=failed_users,
        authenticated=False,
        total_loaded_count=total_loaded_count,
        processed_count=processed_count,
        last_processed_username=data.get("lastProcessedUsername"),
        last_error=data.get("lastError"),
        resolved_user_ids=resolved_user_ids,
    )


def save_context_to_disk(context: ClientSessionContext) -> None:
    payload = {
        "clientSessionId": context.client_session_id,
        "instagramUsername": context.instagram_username,
        "pendingUsers": context.pending_users,
        "failedUsers": context.failed_users,
        "resolvedUserIds": context.resolved_user_ids,
        "totalLoadedCount": context.total_loaded_count,
        "processedCount": context.processed_count,
        "lastProcessedUsername": context.last_processed_username,
        "lastError": context.last_error,
        "updatedAt": now_timestamp(),
    }

    with open(client_state_path(context.client_session_id), "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=True, indent=2)


def delete_context_from_disk(client_session_id: str) -> None:
    path = client_state_path(client_session_id)
    if os.path.exists(path):
        os.remove(path)


def get_or_create_context(client_session_id: str) -> ClientSessionContext:
    with CONTEXTS_LOCK:
        existing = CONTEXTS_BY_CLIENT_ID.get(client_session_id)
        if existing:
            existing.last_active_at = time.time()
            return existing

        context = load_context_from_disk(client_session_id)
        CONTEXTS_BY_CLIENT_ID[client_session_id] = context
        return context


def parse_client_session_id() -> str:
    if request.method == "GET":
        raw_client_session_id = request.args.get("clientSessionId", "")
    else:
        payload = request.get_json(silent=True) or {}
        raw_client_session_id = payload.get("clientSessionId", "")

    client_session_id = str(raw_client_session_id).strip()
    if not client_session_id or len(client_session_id) > 200:
        raise ValueError("Missing or invalid clientSessionId")

    return client_session_id


def serialize_context(context: ClientSessionContext) -> dict:
    return {
        "success": True,
        "clientSessionId": context.client_session_id,
        "authenticated": context.authenticated,
        "instagramUsername": context.instagram_username if context.authenticated else None,
        "pendingCount": len(context.pending_users),
        "remainingCount": len(context.pending_users),
        "failedCount": len(context.failed_users),
    }


def serialize_queue_state(context: ClientSessionContext) -> dict:
    payload = serialize_context(context)
    payload.update({
        "remainingUsers": list(context.pending_users),
        "failedUsers": list(context.failed_users),
        "remainingCount": len(context.pending_users),
        "isProcessing": context.is_processing,
        "stopRequested": context.stop_requested,
        "currentUsername": context.current_username,
        "lastProcessedUsername": context.last_processed_username,
        "lastError": context.last_error,
        "processedCount": context.processed_count,
        "totalLoadedCount": context.total_loaded_count,
    })
    return payload


def set_pending_users(context: ClientSessionContext, usernames) -> list[str]:
    sanitized = sanitize_usernames(usernames)
    context.pending_users = sanitized
    context.failed_users = []
    context.total_loaded_count = len(sanitized)
    context.processed_count = 0
    context.current_username = None
    context.last_processed_username = None
    context.last_error = None
    context.is_processing = False
    context.stop_requested = False
    context.prefetching_usernames.clear()
    context.worker = None
    context.resolver = None
    context.last_active_at = time.time()
    save_context_to_disk(context)
    return sanitized


def remove_pending_user(context: ClientSessionContext, username: str) -> bool:
    normalized_target = normalize_username(username)
    updated_users = [
        current_username
        for current_username in context.pending_users
        if normalize_username(current_username) != normalized_target
    ]
    removed = len(context.pending_users) != len(updated_users)
    context.pending_users = updated_users
    context.last_active_at = time.time()
    return removed


def remove_failed_user(context: ClientSessionContext, username: str) -> bool:
    normalized_target = normalize_username(username)
    updated_users = [
        failed_user
        for failed_user in context.failed_users
        if normalize_username(str(failed_user.get("username", ""))) != normalized_target
    ]
    removed = len(context.failed_users) != len(updated_users)
    context.failed_users = updated_users
    context.last_active_at = time.time()
    return removed


def record_failed_user(context: ClientSessionContext, username: str, reason: str) -> None:
    sanitized_username = sanitize_username(username)
    normalized_target = normalize_username(sanitized_username)
    failed_at = now_timestamp()
    failed_user = {
        "username": sanitized_username,
        "reason": reason,
        "failedAt": failed_at,
    }

    remove_pending_user(context, sanitized_username)

    replaced = False
    for index, current_failed_user in enumerate(context.failed_users):
        if normalize_username(str(current_failed_user.get("username", ""))) == normalized_target:
            context.failed_users[index] = failed_user
            replaced = True
            break

    if not replaced:
        context.failed_users.append(failed_user)

    context.current_username = None
    context.last_error = reason
    context.last_active_at = time.time()


def login_context(
    context: ClientSessionContext,
    instagram_username: str,
    instagram_password: str,
    instagram_verification_code: str = "",
) -> None:
    sanitized_username = sanitize_username(instagram_username)
    if not sanitized_username:
        raise ValueError("Instagram username is required")

    if not instagram_password:
        raise ValueError("Instagram password is required")

    session_path = instagram_session_path(sanitized_username)
    client = create_instagram_client()
    verification_code = re.sub(r"\s+", "", instagram_verification_code or "")

    def challenge_code_handler(username, choice=None):
        if verification_code:
            return verification_code

        channel = "מייל או SMS"
        if choice:
            channel = str(choice)
        raise VerificationCodeRequired(
            f"Instagram requires a verification code for @{username}. Check {channel} or approve the login in Instagram, then enter the code in the site."
        )

    client.challenge_code_handler = challenge_code_handler

    if os.path.exists(session_path):
        client.load_settings(session_path)

    client.login(sanitized_username, instagram_password, verification_code=verification_code)
    client.get_timeline_feed()
    client.dump_settings(session_path)

    if context.instagram_username and normalize_username(context.instagram_username) != normalize_username(sanitized_username):
        set_pending_users(context, [])

    context.instagram_username = sanitized_username
    context.client = client
    context.authenticated = True
    context.last_error = None
    context.last_active_at = time.time()
    save_context_to_disk(context)


def logout_context(context: ClientSessionContext) -> None:
    context.client = None
    context.authenticated = False
    context.instagram_username = None
    context.pending_users = []
    context.failed_users = []
    context.total_loaded_count = 0
    context.processed_count = 0
    context.current_username = None
    context.last_processed_username = None
    context.last_error = None
    context.is_processing = False
    context.stop_requested = False
    context.resolved_user_ids.clear()
    context.prefetching_usernames.clear()
    context.worker = None
    context.resolver = None
    context.last_active_at = time.time()
    delete_context_from_disk(context.client_session_id)


def require_authenticated_context(context: ClientSessionContext) -> Optional[dict]:
    if context.authenticated and context.client is not None and context.instagram_username:
        return None

    return {
        "success": False,
        "error": "This session is not logged in. Please sign in with your Instagram account first.",
    }


def require_mutable_queue(context: ClientSessionContext) -> Optional[tuple[dict, int]]:
    if context.is_processing:
        return ({
            "success": False,
            "error": "The unfollow queue is running. Stop it before editing the list or logging out.",
        }, 409)

    return None


def resolve_user_id(context: ClientSessionContext, username: str, client: Client) -> int:
    normalized = normalize_username(username)
    cached_user_id = context.resolved_user_ids.get(normalized)
    if cached_user_id is not None:
        return cached_user_id

    user_id = int(client.user_id_from_username(username))
    context.resolved_user_ids[normalized] = user_id
    return user_id


def create_prefetch_client(instagram_username: str) -> Client:
    client = create_instagram_client()
    session_path = instagram_session_path(instagram_username)
    if os.path.exists(session_path):
        client.load_settings(session_path)
    return client


def get_prefetch_candidate(context: ClientSessionContext) -> Optional[str]:
    current_username = normalize_username(context.current_username or "")

    for username in context.pending_users[: USER_ID_PREFETCH_LOOKAHEAD + 1]:
        normalized = normalize_username(username)
        if normalized == current_username:
            continue
        if normalized in context.resolved_user_ids or normalized in context.prefetching_usernames:
            continue
        return username

    return None


def prefetch_user_ids_for_context(client_session_id: str) -> None:
    context = get_or_create_context(client_session_id)
    resolver_client: Optional[Client] = None

    while True:
        with context.lock:
            if not context.is_processing or context.stop_requested or not context.authenticated or not context.instagram_username:
                context.prefetching_usernames.clear()
                context.resolver = None
                return

            username = get_prefetch_candidate(context)
            if username:
                context.prefetching_usernames.add(normalize_username(username))

        if not username:
            time.sleep(PREFETCH_IDLE_SLEEP_SECONDS)
            continue

        if resolver_client is None:
            resolver_client = create_prefetch_client(context.instagram_username)

        normalized = normalize_username(username)

        try:
            resolved_user_id = int(resolver_client.user_id_from_username(username))
        except Exception:
            resolved_user_id = None

        with context.lock:
            context.prefetching_usernames.discard(normalized)
            if resolved_user_id is not None:
                context.resolved_user_ids[normalized] = resolved_user_id
                context.last_active_at = time.time()


def ensure_prefetch_worker(context: ClientSessionContext) -> None:
    if context.resolver and context.resolver.is_alive():
        return

    resolver = threading.Thread(
        target=prefetch_user_ids_for_context,
        args=(context.client_session_id,),
        daemon=True,
        name=f"user-id-prefetch-{safe_path_component(context.client_session_id)}",
    )
    context.resolver = resolver
    resolver.start()


def finish_worker(context: ClientSessionContext, error_message: Optional[str] = None) -> None:
    context.is_processing = False
    context.stop_requested = False
    context.current_username = None
    context.prefetching_usernames.clear()
    context.worker = None
    context.resolver = None
    context.last_error = error_message
    context.last_active_at = time.time()
    save_context_to_disk(context)


def process_queue_for_context(client_session_id: str) -> None:
    context = get_or_create_context(client_session_id)

    while True:
        with context.lock:
            auth_error = require_authenticated_context(context)
            if auth_error:
                finish_worker(context, auth_error["error"])
                return

            if context.stop_requested:
                finish_worker(context, None)
                return

            if not context.pending_users:
                finish_worker(context, None)
                return

            username = context.pending_users[0]
            context.current_username = username
            context.last_active_at = time.time()
            client = context.client

        try:
            if client is None:
                raise RuntimeError("Instagram client is unavailable for this session.")

            user_id = resolve_user_id(context, username, client)
            unfollowed = client.user_unfollow(user_id)
        except LoginRequired:
            with context.lock:
                context.client = None
                context.authenticated = False
                finish_worker(context, "Instagram session expired. Please sign in again.")
            return
        except (RateLimitError, FeedbackRequired, ChallengeError) as error:
            with context.lock:
                finish_worker(context, f"Instagram temporarily blocked the queue while unfollowing @{username}: {error}")
            return
        except Exception as error:
            with context.lock:
                record_failed_user(context, username, f"Failed while unfollowing @{username}: {error}")
                save_context_to_disk(context)
            continue

        with context.lock:
            if not unfollowed:
                record_failed_user(context, username, f"Instagram refused to unfollow @{username}.")
                save_context_to_disk(context)
                continue

            removed = remove_pending_user(context, username)
            remove_failed_user(context, username)
            context.current_username = None
            context.last_processed_username = username
            context.last_error = None
            if removed:
                context.processed_count = min(context.total_loaded_count, context.processed_count + 1)
            save_context_to_disk(context)


@app.route("/health", methods=["GET"])
def health():
    active_workers = 0
    with CONTEXTS_LOCK:
        for context in CONTEXTS_BY_CLIENT_ID.values():
            if context.is_processing:
                active_workers += 1

    return jsonify({
        "status": "ok",
        "activeClientSessions": len(CONTEXTS_BY_CLIENT_ID),
        "activeWorkers": active_workers,
    })


@app.route("/api/auth/status", methods=["GET"])
def auth_status():
    try:
        client_session_id = parse_client_session_id()
    except ValueError as error:
        return jsonify({"success": False, "error": str(error)}), 400

    context = get_or_create_context(client_session_id)
    with context.lock:
        return jsonify(serialize_queue_state(context))


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    payload = request.get_json(silent=True) or {}

    try:
        client_session_id = parse_client_session_id()
    except ValueError as error:
        return jsonify({"success": False, "error": str(error)}), 400

    instagram_username = str(payload.get("instagramUsername", "")).strip()
    instagram_password = str(payload.get("instagramPassword", ""))
    instagram_verification_code = str(payload.get("instagramVerificationCode", ""))
    context = get_or_create_context(client_session_id)

    try:
        with context.lock:
            mutation_error = require_mutable_queue(context)
            if mutation_error:
                return jsonify(mutation_error[0]), mutation_error[1]

            login_context(context, instagram_username, instagram_password, instagram_verification_code)
            return jsonify(serialize_queue_state(context))
    except VerificationCodeRequired as error:
        return jsonify({"success": False, "challengeRequired": True, "error": str(error)}), 401
    except ValueError as error:
        return jsonify({"success": False, "error": str(error)}), 400
    except Exception as error:
        return jsonify({"success": False, "error": str(error)}), 500


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    try:
        client_session_id = parse_client_session_id()
    except ValueError as error:
        return jsonify({"success": False, "error": str(error)}), 400

    context = get_or_create_context(client_session_id)
    with context.lock:
        mutation_error = require_mutable_queue(context)
        if mutation_error:
            return jsonify(mutation_error[0]), mutation_error[1]

        logout_context(context)
        return jsonify({"success": True, "clientSessionId": client_session_id})


@app.route("/api/sync-state", methods=["GET"])
def sync_state():
    try:
        client_session_id = parse_client_session_id()
    except ValueError as error:
        return jsonify({"success": False, "error": str(error)}), 400

    context = get_or_create_context(client_session_id)
    with context.lock:
        return jsonify(serialize_queue_state(context))


@app.route("/api/queue/status", methods=["GET"])
def queue_status():
    try:
        client_session_id = parse_client_session_id()
    except ValueError as error:
        return jsonify({"success": False, "error": str(error)}), 400

    context = get_or_create_context(client_session_id)
    with context.lock:
        return jsonify(serialize_queue_state(context))


@app.route("/api/replace-users", methods=["POST"])
def replace_users():
    payload = request.get_json(silent=True) or {}

    try:
        client_session_id = parse_client_session_id()
    except ValueError as error:
        return jsonify({"success": False, "error": str(error)}), 400

    usernames = payload.get("usernames")
    if not isinstance(usernames, list):
        return jsonify({"success": False, "error": "Expected a usernames array"}), 400

    context = get_or_create_context(client_session_id)
    with context.lock:
        mutation_error = require_mutable_queue(context)
        if mutation_error:
            return jsonify(mutation_error[0]), mutation_error[1]

        updated_users = set_pending_users(context, usernames)
        response = serialize_queue_state(context)
        response.update({
            "remainingUsers": updated_users,
            "remainingCount": len(updated_users),
        })
        return jsonify(response)


@app.route("/api/queue/start", methods=["POST"])
def queue_start():
    try:
        client_session_id = parse_client_session_id()
    except ValueError as error:
        return jsonify({"success": False, "error": str(error)}), 400

    context = get_or_create_context(client_session_id)
    with context.lock:
        auth_error = require_authenticated_context(context)
        if auth_error:
            return jsonify(auth_error), 401

        if not context.pending_users:
            return jsonify({"success": False, "error": "There are no pending users in this session queue."}), 400

        if context.is_processing:
            ensure_prefetch_worker(context)
            return jsonify(serialize_queue_state(context))

        context.is_processing = True
        context.stop_requested = False
        context.last_error = None
        context.current_username = None
        context.last_active_at = time.time()
        worker = threading.Thread(
            target=process_queue_for_context,
            args=(context.client_session_id,),
            daemon=True,
            name=f"unfollow-worker-{safe_path_component(context.client_session_id)}",
        )
        context.worker = worker
        ensure_prefetch_worker(context)
        save_context_to_disk(context)
        worker.start()
        return jsonify(serialize_queue_state(context))


@app.route("/api/queue/stop", methods=["POST"])
def queue_stop():
    try:
        client_session_id = parse_client_session_id()
    except ValueError as error:
        return jsonify({"success": False, "error": str(error)}), 400

    context = get_or_create_context(client_session_id)
    with context.lock:
        if context.is_processing:
            context.stop_requested = True
            context.last_active_at = time.time()
            save_context_to_disk(context)

        return jsonify(serialize_queue_state(context))


@app.route("/api/unfollow", methods=["POST"])
def unfollow():
    payload = request.get_json(silent=True) or {}

    try:
        client_session_id = parse_client_session_id()
    except ValueError as error:
        return jsonify({"success": False, "error": str(error)}), 400

    username = str(payload.get("username", "")).strip()
    if not username:
        return jsonify({"success": False, "error": "No username provided"}), 400

    context = get_or_create_context(client_session_id)
    with context.lock:
        auth_error = require_authenticated_context(context)
        if auth_error:
            return jsonify(auth_error), 401

        if context.is_processing:
            return jsonify({
                "success": False,
                "error": "The queue is currently running. Stop it before triggering manual unfollows.",
            }), 409

        client = context.client

    try:
        if client is None:
            raise RuntimeError("Instagram client is unavailable for this session.")

        print(f"[{context.client_session_id}] Attempting to unfollow {username} for {context.instagram_username}...")
        user_id = resolve_user_id(context, username, client)
        unfollowed = client.user_unfollow(user_id)
    except LoginRequired:
        with context.lock:
            context.client = None
            context.authenticated = False
            context.last_error = "Instagram session expired. Please sign in again."
            save_context_to_disk(context)
        return jsonify({"success": False, "error": "Instagram session expired. Please sign in again."}), 401
    except (RateLimitError, FeedbackRequired, ChallengeError) as error:
        with context.lock:
            context.last_error = f"Instagram temporarily blocked the unfollow request for @{username}: {error}"
            save_context_to_disk(context)
        return jsonify({"success": False, "error": context.last_error}), 429
    except Exception as error:
        print(f"[{context.client_session_id}] API Error with {username}: {error}")
        with context.lock:
            record_failed_user(context, username, f"Failed while unfollowing @{username}: {error}")
            save_context_to_disk(context)
            error_message = context.last_error
        return jsonify({"success": False, "error": error_message}), 500

    with context.lock:
        if not unfollowed:
            record_failed_user(context, username, f"Instagram refused to unfollow @{username}.")
            save_context_to_disk(context)
            return jsonify({"success": False, "error": context.last_error}), 400

        removed = remove_pending_user(context, username)
        remove_failed_user(context, username)
        context.last_processed_username = username
        context.last_error = None
        if removed:
            context.processed_count = min(context.total_loaded_count, context.processed_count + 1)
        save_context_to_disk(context)

        response = serialize_queue_state(context)
        response.update({
            "username": username,
            "removedFromRemaining": removed,
        })
        return jsonify(response)


if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "5000"))
    app.run(host=host, port=port, threaded=True)
