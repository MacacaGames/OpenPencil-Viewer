#!/usr/bin/env python3
"""Fixed read-only operations. No shell, credentials, writes, or impersonation."""
import os, sys, stat, json, hashlib
DENIED = {'#recycle', '#snapshot', '@eaDir', '@SynologyDrive', '.git'}
MAX_ENTRIES = 100000
MAX_DEPTH = 64

def mount_id(fd):
    if sys.platform != 'linux': return None  # Development only; not a DSM attestation.
    with open('/proc/self/fdinfo/'+str(fd), encoding='ascii') as info:
        for line in info:
            if line.startswith('mnt_id:'): return int(line.split(':',1)[1])
    raise ValueError('mount identity unavailable')

def confined(fd, dev, mount):
    if os.fstat(fd).st_dev != dev or mount_id(fd) != mount:
        raise ValueError('nested mount forbidden')

def revision(s):
    return ':'.join(str(x) for x in (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns))

def parts(path):
    if not path or '\\' in path or '\x00' in path or '%' in path:
        raise ValueError('invalid path')
    result = path.split('/')
    if any(x in ('', '.', '..') or x in DENIED for x in result):
        raise ValueError('invalid path')
    return result

def root_open(path):
    if not path.startswith('/') or path == '/':
        raise ValueError('explicit absolute root required')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in parts(path[1:]):
            next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd
    except BaseException:
        os.close(fd)
        raise

def safe_open(rootfd, relative, dev):
    components = parts(relative)
    fd = os.dup(rootfd)
    try:
        root_mount=mount_id(rootfd)
        for idx, component in enumerate(components):
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            if idx < len(components)-1: flags |= os.O_DIRECTORY
            elif sys.platform == 'linux': flags = os.O_PATH | os.O_NOFOLLOW
            next_fd = os.open(component, flags, dir_fd=fd)
            os.close(fd)
            fd = next_fd
            confined(fd, dev, root_mount)
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or not relative.lower().endswith('.fig'):
            raise ValueError('regular single-link fig required')
        if sys.platform == 'linux':
            # O_PATH pins and checks type before a device can be opened for I/O.
            # The fixed proc descriptor path reopens that object, not the original name.
            readable=os.open('/proc/self/fd/'+str(fd),os.O_RDONLY | os.O_NONBLOCK)
            actual=os.fstat(readable)
            if (actual.st_dev,actual.st_ino)!=(s.st_dev,s.st_ino):
                os.close(readable);raise ValueError('descriptor changed')
            os.close(fd);fd=readable;s=actual
        return fd, s
    except BaseException:
        os.close(fd)
        raise

def scan(fd, dev, relative='', depth=0, result=None, counter=None, mount=None):
    if result is None: result=[]
    if counter is None: counter=[0]
    if depth == 0: mount=mount_id(fd)
    if depth > MAX_DEPTH: raise ValueError('depth limit')
    # listdir(fd) and every open are relative to pinned descriptors.
    for observed in os.scandir(fd):
        counter[0]+=1
        if counter[0]>MAX_ENTRIES: raise ValueError('entry limit')
        name=observed.name
        if name in DENIED or '%' in name or '\\' in name: continue
        child = name if not relative else relative+'/'+name
        info = os.stat(name, dir_fd=fd, follow_symlinks=False)
        if info.st_dev != dev or stat.S_ISLNK(info.st_mode): continue
        if sys.platform == 'linux':
            observed_fd=os.open(name,os.O_PATH | os.O_NOFOLLOW,dir_fd=fd)
            try:
                if mount_id(observed_fd)!=mount: continue
                info=os.fstat(observed_fd)
            finally: os.close(observed_fd)
        if stat.S_ISDIR(info.st_mode):
            nextfd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            try:
                actual = os.fstat(nextfd)
                confined(nextfd,dev,mount)
                result.append({'relative':child,'kind':'folder','size':0,'revision':revision(actual)})
                scan(nextfd,dev,child,depth+1,result,counter,mount)
            finally: os.close(nextfd)
        elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and name.lower().endswith('.fig'):
            # Metadata only; don't open/download the document body on scan.
            result.append({'relative':child,'kind':'file','size':info.st_size,'revision':revision(info)})
        if len(result)>MAX_ENTRIES: raise ValueError('entry limit')
    return result

def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ('scan','read','stat'): raise ValueError('operation')
    rootfd=root_open(sys.argv[2])
    try:
        rootstat=os.fstat(rootfd)
        identity=str(rootstat.st_dev)+':'+str(rootstat.st_ino)
        if sys.argv[1]=='scan':
            print(json.dumps({'identity':identity,'mountId':mount_id(rootfd),'entries':scan(rootfd,rootstat.st_dev)},separators=(',',':')))
            return
        if len(sys.argv)!=7 or sys.argv[4]!=identity: raise ValueError('root changed')
        fd, before=safe_open(rootfd,sys.argv[3],rootstat.st_dev)
        try:
            if revision(before)!=sys.argv[5] or before.st_size>int(sys.argv[6]): raise ValueError('revision or size')
            print(json.dumps({'size':before.st_size,'revision':revision(before)},separators=(',',':')),flush=True)
            if sys.argv[1]=='stat': return
            # Hold the final block until a same-descriptor before/after check passes.
            pending=os.read(fd,min(65536,before.st_size+1))
            received=len(pending)
            while True:
                following=os.read(fd,65536)
                received+=len(following)
                if received>before.st_size or received>int(sys.argv[6]): raise ValueError('source grew')
                if revision(os.fstat(fd))!=revision(before): raise ValueError('source changed')
                if not following: break
                sys.stdout.buffer.write(pending); sys.stdout.buffer.flush()
                pending=following
            if received!=before.st_size or revision(os.fstat(fd))!=revision(before): raise ValueError('source changed')
            sys.stdout.buffer.write(pending); sys.stdout.buffer.flush()
        finally: os.close(fd)
    finally: os.close(rootfd)

if __name__=='__main__':
    try: main()
    except (OSError,ValueError,AttributeError):
        # Do not expose private host paths or filenames in stderr.
        sys.stderr.write('source-unavailable-or-changed\n')
        sys.exit(2)
