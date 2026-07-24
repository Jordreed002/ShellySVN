#!/bin/sh
set -eu

repository_root=/var/lib/svn
repository_path="${repository_root}/repo"
svn_username="${SVN_USERNAME:-shellysvn}"
svn_password="${SVN_PASSWORD:-release-test}"
svn_second_username="${SVN_SECOND_USERNAME:-reviewer}"
svn_second_password="${SVN_SECOND_PASSWORD:-review-test}"

mkdir -p "${repository_root}"

if [ ! -d "${repository_path}/db" ]; then
  svnadmin create "${repository_path}"
fi

cat >"${repository_path}/conf/svnserve.conf" <<EOF
[general]
anon-access = none
auth-access = write
password-db = passwd
authz-db = authz
realm = ShellySVN compatibility lab
EOF

cat >"${repository_path}/conf/passwd" <<EOF
[users]
${svn_username} = ${svn_password}
${svn_second_username} = ${svn_second_password}
EOF

cat >"${repository_path}/conf/authz" <<EOF
[groups]
writers = ${svn_username}, ${svn_second_username}

[/]
@writers = rw
EOF

htpasswd -bc /etc/apache2/shellysvn.passwd "${svn_username}" "${svn_password}"
htpasswd -b /etc/apache2/shellysvn.passwd "${svn_second_username}" "${svn_second_password}"
chown root:www-data /etc/apache2/shellysvn.passwd
chmod 0640 /etc/apache2/shellysvn.passwd

if [ ! -f /etc/apache2/shellysvn.crt ] || [ ! -f /etc/apache2/shellysvn.key ]; then
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout /etc/apache2/shellysvn.key \
    -out /etc/apache2/shellysvn.crt \
    -days 30 \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
fi

cat >"${repository_path}/hooks/pre-revprop-change" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod 0755 "${repository_path}/hooks/pre-revprop-change"

repository_url="file://${repository_path}"
if ! svn list "${repository_url}/trunk" >/dev/null 2>&1; then
  svn mkdir -m "Create ShellySVN compatibility layout" \
    "${repository_url}/trunk" \
    "${repository_url}/branches" \
    "${repository_url}/tags" \
    "${repository_url}/sandbox"

  seed_root="$(mktemp -d)"
  mkdir -p "${seed_root}/src"
  printf '# ShellySVN compatibility lab\n' >"${seed_root}/README.md"
  printf 'line one\nline two\n' >"${seed_root}/src/app.txt"
  svn import -m "Seed ShellySVN compatibility repository" \
    "${seed_root}" "${repository_url}/trunk"
  rm -rf "${seed_root}"
fi

chown -R www-data:www-data "${repository_root}"

svnserve --daemon \
  --root "${repository_root}" \
  --listen-host 0.0.0.0 \
  --listen-port 3690 \
  --pid-file /run/svnserve.pid

exec apache2ctl -D FOREGROUND
