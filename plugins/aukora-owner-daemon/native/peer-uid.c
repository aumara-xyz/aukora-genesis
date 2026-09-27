/* Read kernel credentials from the connected Unix socket inherited as fd 3.
 * This program has no privilege and accepts no caller-supplied identity. */
#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <stdio.h>
#include <stdint.h>
#include <inttypes.h>

int main(void) {
  struct sockaddr_un address;
  socklen_t length = sizeof(address);
  uid_t uid;
  if (getpeername(3, (struct sockaddr *)&address, &length) != 0 ||
      address.sun_family != AF_UNIX) return 1;
#if defined(__APPLE__) || defined(__FreeBSD__)
  gid_t gid;
  if (getpeereid(3, &uid, &gid) != 0) return 1;
#elif defined(__linux__)
  struct ucred credentials;
  length = sizeof(credentials);
  if (getsockopt(3, SOL_SOCKET, SO_PEERCRED, &credentials, &length) != 0 ||
      length != sizeof(credentials)) return 1;
  uid = credentials.uid;
#else
  return 1;
#endif
  printf("%ju\n", (uintmax_t)uid);
  return 0;
}
