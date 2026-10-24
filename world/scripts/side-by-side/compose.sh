#!/usr/bin/env bash
# Usage: compose.sh <captions dir> <video dir> <left offset s> <right offset s> <seconds> <out.mp4>
# Joins the two recordings from record.mjs (left.webm, right.webm) side by side, each under
# its label, between a title card and an end card. Captions are text files in the captions
# dir: left/right labels, title lines t1-t3, end lines e1-e4. The offsets are what record.mjs printed.
set -euo pipefail
C=$(realpath "$1") V=$(realpath "$2") L=$3 R=$4 D=$5 OUT=$(realpath "$6")
SERIF=/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf
SANS=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
INK=0x293f39 PAPER=0xf4eede CREAM=0xf0e4cc MUTED=0xb9c2a8
label() { echo "fps=30,setsar=1,pad=960:770:0:50:color=$PAPER,drawtext=fontfile=$SERIF:textfile=$C/$1:x=22:y=14:fontsize=21:fontcolor=$INK"; }
ffmpeg -hide_banner -loglevel error -y \
  -ss "$L" -t "$D" -i "$V/left.webm" -ss "$R" -t "$D" -i "$V/right.webm" \
  -f lavfi -t 5 -i "color=c=$INK:s=1924x770:r=30" -f lavfi -t 8 -i "color=c=$INK:s=1924x770:r=30" \
  -filter_complex "
    [0]$(label left.txt),pad=964:770:0:0:color=$INK[a];
    [1]$(label right.txt)[b];
    [a][b]hstack=inputs=2[main];
    [2]setsar=1,drawtext=fontfile=$SERIF:textfile=$C/t1.txt:x=(w-tw)/2:y=270:fontsize=54:fontcolor=$CREAM,
        drawtext=fontfile=$SANS:textfile=$C/t2.txt:x=(w-tw)/2:y=370:fontsize=28:fontcolor=$CREAM,
        drawtext=fontfile=$SANS:textfile=$C/t3.txt:x=(w-tw)/2:y=460:fontsize=18:fontcolor=$MUTED[title];
    [3]setsar=1,drawtext=fontfile=$SANS:textfile=$C/e1.txt:x=(w-tw)/2:y=230:fontsize=30:fontcolor=0xf2b8a2,
        drawtext=fontfile=$SANS:textfile=$C/e2.txt:x=(w-tw)/2:y=290:fontsize=30:fontcolor=0xc5e0b4,
        drawtext=fontfile=$SERIF:textfile=$C/e3.txt:x=(w-tw)/2:y=390:fontsize=46:fontcolor=$CREAM,
        drawtext=fontfile=$SANS:textfile=$C/e4.txt:x=(w-tw)/2:y=500:fontsize=18:fontcolor=$MUTED[end];
    [title][main][end]concat=n=3:v=1:a=0[v]" \
  -map "[v]" -c:v libx264 -preset slow -crf "${CRF:-30}" -pix_fmt yuv420p -movflags +faststart "$OUT"
