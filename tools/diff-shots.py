#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Сравнивает два каталога скриншотов (_shots vs _shots2) по md5.
   Нужно для проверки «картинка не поехала» после правок движка.
   Работает, потому что в run-tests.py время rAF фиксировано."""
import hashlib, os, sys

a_dir, b_dir = sys.argv[1], sys.argv[2]
if not os.path.isdir(a_dir) or not os.path.isdir(b_dir):
    sys.exit("нужны два существующих каталога со скриншотами")


def h(p):
    return hashlib.md5(open(p, "rb").read()).hexdigest()


names = sorted(f for f in os.listdir(a_dir) if f.endswith(".png"))
same, diff, only = [], [], []
for n in names:
    p2 = os.path.join(b_dir, n)
    if not os.path.exists(p2):
        only.append(n)
        continue
    (same if h(os.path.join(a_dir, n)) == h(p2) else diff).append(n)
print("одинаково: %d, отличается: %d, нет во втором: %d" % (len(same), len(diff), len(only)))
if diff:
    print("ОТЛИЧАЮТСЯ:")
    for n in diff:
        print("   " + n)
if only:
    print("нет во втором:", only)
