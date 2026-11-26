# logs in to instagram once, with instaloader, and writes the session's
# cookies as a cookie header for the api. the password isn't stored anywhere.
# run by `cookie.sh login instagram` in a throwaway python container:
#
#   python instagram-login.py <credentials.json> <output file>
#
# exit codes: 0 logged in, 2 wrong username or password, 3 instagram wants
# the login confirmed (checkpoint), 4 the 2fa code didn't work, 5 other errors

import json
import sys

import instaloader
from instaloader.exceptions import (
    BadCredentialsException,
    ConnectionException,
    LoginException,
    TwoFactorAuthRequiredException,
)

# what the api needs to be logged in (see cookie.sh)
NEEDED = ("sessionid", "ds_user_id", "csrftoken")


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def login(loader, username, password, read_code=input):
    try:
        loader.login(username, password)
        return
    except TwoFactorAuthRequiredException:
        pass

    for _ in range(3):
        code = read_code("instagram sent you a login code (2fa), enter it: ").strip()
        try:
            loader.two_factor_login(code)
            return
        except BadCredentialsException:
            print("that code didn't work, try again.", file=sys.stderr)

    fail(4, "the 2fa code didn't work three times.")


def cookie_header(cookies):
    header = "; ".join(f"{name}={value}" for name, value in cookies.items() if value)
    missing = [name for name in NEEDED if not cookies.get(name)]
    return header, missing


def main(credentials_path, output_path, make_loader=None, read_code=input):
    with open(credentials_path) as f:
        credentials = json.load(f)

    loader = (make_loader or (lambda: instaloader.Instaloader(quiet=True, max_connection_attempts=1)))()

    try:
        login(loader, credentials["username"], credentials["password"], read_code)
    except BadCredentialsException:
        fail(2, "wrong username or password.")
    except (LoginException, ConnectionException) as e:
        message = str(e)
        if "checkpoint" in message.lower() or "challenge" in message.lower():
            fail(3, "instagram wants you to confirm this login. open the instagram app "
                    "(or instagram.com) with this account, confirm it was you "
                    "(\"this was me\"), then run this again.\n" + message)
        fail(5, f"instagram didn't let this log in: {message}")

    # pylint:disable=protected-access
    cookies = loader.context._session.cookies.get_dict(domain=".instagram.com") \
        or loader.context._session.cookies.get_dict()

    header, missing = cookie_header(cookies)
    if missing:
        fail(5, f"logged in, but instagram didn't give these cookies: {', '.join(missing)}")

    with open(output_path, "w") as f:
        f.write(header)

    print(f"logged in as {credentials['username']}.")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
