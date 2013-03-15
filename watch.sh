#!/bin/bash

echo main.js sample.alien alienscript.jison | peat 'jison alienscript.jison -o alienparse && cat sample.alien | pygmentize -l clojure && echo && node main.js sample.alien | pygmentize -l js'
