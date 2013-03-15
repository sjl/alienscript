%lex
%%

\s+        /* whitespace */
";"[^\n]+  /* comments */

"!"  { return '!'; }
"["  { return '['; }
"]"  { return ']'; }
"("  { return '('; }
")"  { return ')'; }
"{"  { return 'OPCURLY'; }
"}"  { return 'CLCURLY'; }

\"(\\.|[^"])*\"  yytext = yytext.substr(1,yyleng-2); return 'STRING';

"-"?[0-9]+"."[0-9]+ { return 'FLOAT'; }
"-"?[0-9]+          { return 'INT'; }

nil  { return 'NIL'; }
true  { return 'TRUE'; }
false  { return 'FALSE'; }

[-+/*_<>=a-zA-Z.]+  { return 'SYMBOL'; }

<<EOF>>    { return 'EOF'; }

/lex

%{

function Symbol(name) {
    this.name = name;
}

Symbol.prototype.inspect = function() {
    return "Symbol(\"" + this.name + "\")";
}
Symbol.prototype.__alienscript_tag = "S";


%}

%%

file
  : sexps EOF
    { return $sexps; }
  ;

sexps
  : sexp
    { $$ = [$sexp]; }
  | sexp sexps
    { $$ = [$sexp].concat($sexps); }
  ;

sexp
  : atom
    { $$ = $atom; }
  | list
    { $$ = $list; }
  | rawlist
    { $$ = $rawlist; }
  | hash
    { $$ = $hash; }
  ;

hash
  : 'OPCURLY' 'CLCURLY'
    { $$ = ['hash']; }
  | 'OPCURLY' pairs 'CLCURLY'
    { $$ = ['hash'].concat($pairs); }
  ;

pairs
  : pair
    { $$ = [$pair]; }
  | pair pairs
    { $$ = [$pair].concat($pairs); }
  ;

pair
  : sexp sexp
    { $$ = [$sexp1, $sexp2]; }
  ;

list
  : '(' ')'
    { $$ = []; }
  | '(' items ')'
    { $$ = $items; }
  ;

rawlist
  : '[' ']'
    { $$ = [new Symbol('list')]; }
  | '[' items ']'
    { $$ = [new Symbol('list')].concat($items); }
  ;

items
  : sexp
    { $$ = [$sexp]; }
  | sexp items
    { $$ = [$sexp].concat($items); }
  ;

boolean
  : TRUE
    { $$ = true; }
  | FALSE
    { $$ = false; }
  ;

atom
  : INT
    { $$ = parseInt($INT, 10); }
  | FLOAT
    { $$ = parseFloat($FLOAT); }
  | STRING
    { $$ = $STRING; }
  | boolean
    { $$ = $boolean; }
  | SYMBOL
    { $$ = new Symbol($SYMBOL); }
  | NIL
    { $$ = null; }
  ;


