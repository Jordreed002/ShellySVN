FROM debian:bookworm-slim

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    apache2 \
    apache2-utils \
    ca-certificates \
    libapache2-mod-svn \
    openssl \
    subversion \
  && rm -rf /var/lib/apt/lists/*

COPY apache-svn.conf /etc/apache2/sites-available/shellysvn-compat.conf
COPY entrypoint.sh /usr/local/bin/shellysvn-compat-entrypoint

RUN chmod 0755 /usr/local/bin/shellysvn-compat-entrypoint \
  && a2enmod auth_basic dav dav_svn ssl \
  && a2dissite 000-default default-ssl \
  && a2ensite shellysvn-compat

EXPOSE 3690 8080 8443

VOLUME ["/var/lib/svn"]

HEALTHCHECK --interval=2s --timeout=3s --start-period=5s --retries=20 \
  CMD svn list --non-interactive --no-auth-cache \
    --username "${SVN_USERNAME:-shellysvn}" \
    --password "${SVN_PASSWORD:-release-test}" \
    svn://127.0.0.1:3690/repo/trunk >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/shellysvn-compat-entrypoint"]
