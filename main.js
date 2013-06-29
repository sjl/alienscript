//  _______ _  _                              _
// (_______) |(_)                            (_)       _
//  _______| | _ _____ ____   ___  ____  ____ _ ____ _| |_
// |  ___  | || | ___ |  _ \ /___)/ ___)/ ___) |  _ (_   _)
// | |   | | || | ____| | | |___ ( (___| |   | | |_| || |_
// |_|   |_|\_)_|_____)_| |_(___/ \____)_|   |_|  __/  \__)
// Copyright 2013 Steve Losh & contributors    |_|
//
// If you're reading this you're probably wondering how this all works.  It's
// not pretty but here it is.
//
// In a nutshell, Alienscript compilation happens like this:
//
// 1. Read a file of Alienscript code into a big 'ol String of text
// 2. Parse that String with Jison to get a series of "Abstract Syntax Shrubs":
//    Javascript data structures representing the sexps inside.
// 3. For each shrub:
//    A. "Grow" the ASS into a Javascript Abstract Syntax Tree by massaging the
//       sexp into an Object suitable for passing to escodegen.
//    B. Pass the AST to escodegen to get a hunk of text back representing the
//       Javascript code.
//    C. Write that code to standard out (or a file or whatever).
//    D. Evaluate the code (this is important for real macros, if you don't
//       understand why, turn back now).
//
//  So for example, if we have an Alienscript file with:
//
//      (+ 1 2)
//
//  We read that file into a String:
//
//      '(+ 1 2)'
//
//  We parse that into an ASS:
//
//      [Symbol("+"), 1, 2]
//
//  Then we grow that ASS into an AST:
//
//      { type: "BinaryExpression", operator: "+",
//        left: { type: "Literal", value: 1 },
//        right: { type: "Literal", value: 2 } }
//
//  Then we send that to escodegen and get a String of Javascript code back:
//
//      '1 + 2'
//
//  Then we write that string to the destination (stdout, file, whatever) AND
//  evaluate it before moving on.

var vm = require('vm');
var fs = require('fs');
var util = require('util');
var alienparse = require("./alienparse");
var escodegen = require('escodegen');

// Data types -----------------------------------------------------------------
function Symbol(name) {
    this.name = name;
}
Symbol.prototype.inspect = function() {
    return "Symbol(\"" + this.name + "\")";
};
Symbol.prototype.__alienscript_tag = "S";

function Keyword(name) {
    this.name = name;
}
Keyword.prototype.inspect = function() {
    return ":" + this.name;
};
Keyword.prototype.__alienscript_tag = "K";

// Helpers --------------------------------------------------------------------
// Javascript is such a shitpile.  Here are a few shovels.
var contains = function(arr, el) {
    return arr.indexOf(el) > -1;
};
var map = function(fn, arr) {
    var result = [];
    for (var i = 0; i < arr.length; i++) {
        result.push(fn(arr[i]));
    }
    return result;
};
var slice = function(arr, start, end) {
    if (start !== undefined && end !== undefined) {
        return Array.prototype.slice.call(arr, start, end);
    } else if (start !== undefined) {
        return Array.prototype.slice.call(arr, start);
    } else {
        return Array.prototype.slice.call(arr);
    }
};
var pop = function(arr) {
    return slice(arr, 1);
};
var poplast = function(arr) {
    return slice(arr, 0, arr.length - 1);
};
var last = function(arr) {
    return arr[arr.length - 1];
};
var apply = function(fn, args) {
    return fn.apply(null, args);
};

// Macro storage --------------------------------------------------------------
var macros = {};

// Special form definitions ---------------------------------------------------
//
// Special forms are built into the language.  They receive the rest of the ASS
// *before* it's grown into an AST, so they have the chance to hack at it
// (unlike primitives).
//
// Very few things need this level of power.  Most things can be done as
// primitives, which are a bit less powerful.
var special_forms = {
    "fn": function(elements) {
        var args = elements[0];
        var body = slice(elements, 1);

        args = map(grow, args);
        body = map(grow, body);

        var prereturn = poplast(body);
        var to_return = last(body);

        body = map(function(a) {
            if (isASTHunkAnExpression(a)) {
                return { type: "ExpressionStatement", expression: a };
            } else {
                return a;
            }
        }, prereturn);
        body.push({ type: "ReturnStatement", argument: to_return });

        return { type: "FunctionExpression", id: null,
                 body: { type: "BlockStatement", body: body },
                 params: args,
                 defaults: [], rest: null, generator: false, expression: false };
    },
    "defmacro": function(elements) {
        var name = elements[0];
        var fnexpr = slice(elements, 1)

        name = grow(name).name;

        return { type: "AssignmentExpression", operator: "=",
                 left: { type: "MemberExpression", computed: true,
                         object: { type: "Identifier", name: "macros" },
                         property: { type: "Literal", value: name } },
                 right: special_forms['fn'](fnexpr) };
    }
};

// Primitive definitions ------------------------------------------------------
//
// Primitives are built-in "functions" that are transformed directly into a JS
// AST.  They differ from special forms in that they receive their arguments
// pre-grown into ASTs.
var primitives = {
    ".": function(elements) {
        var obj = elements[0];
        var method = elements[1];
        var args = slice(elements, 2);

        method = { type: "Literal", value: method.name };

        return { type: "CallExpression", callee: {
                    type: "MemberExpression", computed: true,
                    object: obj, property: method,
                 }, arguments: args };
    },
    "symbol": function(elements) {
        var name = elements[0].name;
        return { type: "NewExpression",
                 callee: { type: "Identifier", name: "Symbol" },
                 arguments: [{ type: "Literal", value: name }] };
    },
    "list": function(elements) {
        return { type: "ArrayExpression", elements: elements };
    },
    "not": function(elements) {
        return { type: "UnaryExpression", operator: "!",
                 prefix: true, argument: elements[0] };
    },
    "+": function(elements) {
        if (elements.length == 0) {
            return { type: "Literal", value: 0 };
        } else if (elements.length == 1) {
            return elements[0];
        } else {
            return { type: "BinaryExpression", operator: "+",
                     left: primitives['+'](poplast(elements)),
                     right: last(elements) };
        }
    },
    "*": function(elements) {
        if (elements.length == 0) {
            return { type: "Literal", value: 1 };
        } else if (elements.length == 1) {
            return elements[0];
        } else {
            return { type: "BinaryExpression", operator: "*",
                     left: primitives['*'](poplast(elements)),
                     right: last(elements) };
        }
    },
    "/": function(elements) {
        if (elements.length == 0) {
            return { type: "Literal", value: 1 };
        } else if (elements.length == 1) {
            return elements[0];
        } else {
            return { type: "BinaryExpression", operator: "/",
                     left: primitives['/'](poplast(elements)),
                     right: last(elements) };
        }
    },
    "-": function(elements) {
        if (elements.length == 0) {
            return { type: "Literal", value: 0 };
        } else if (elements.length == 1) {
            return { type: "UnaryExpression", operator: "-",
                     prefix: true,
                     argument: elements[0] };
        } else if (elements.length == 2) {
            return { type: "BinaryExpression", operator: "-",
                     left: elements[0], right: elements[1] };
        } else {
            return { type: "BinaryExpression", operator: "-",
                     left: primitives['-'](poplast(elements)),
                     right: last(elements) };
        }
    },
    ">": function(elements) {
        if (elements.length == 2) {
            return { type: "BinaryExpression", operator: ">",
                     left: elements[0], right: elements[1] };
        } else {
            return "unknown";
        }
    },
    "<": function(elements) {
        if (elements.length == 2) {
            return { type: "BinaryExpression", operator: "<",
                     left: elements[0], right: elements[1] };
        } else {
            return "unknown";
        }
    },
    ">=": function(elements) {
        if (elements.length == 2) {
            return { type: "BinaryExpression", operator: ">=",
                     left: elements[0], right: elements[1] };
        } else {
            return "unknown";
        }
    },
    "<=": function(elements) {
        if (elements.length == 2) {
            return { type: "BinaryExpression", operator: "<=",
                     left: elements[0], right: elements[1] };
        } else {
            return "unknown";
        }
    },
    "=": function(elements) {
        if (elements.length == 2) {
            return { type: "BinaryExpression", operator: "===",
                     left: elements[0], right: elements[1] };
        } else {
            return "unknown";
        }
    },
    "get": function(elements) {
        var obj = elements[0];
        var idx = elements[1];

        return { type: "MemberExpression", computed: true,
                 object: obj, property: idx }
    },
    "def": function(elements) {
        var name = elements[0];

        var value;
        if (elements.length > 1) {
            value = elements[1];
        } else {
            value = { type: "Literal", value: null };
        }

        return { type: "VariableDeclaration",
                 kind: "var",
                 declarations: [{ type: "VariableDeclarator",
                                  id: name, init: value }] };
    },
    "if": function(elements) {
        var cond = elements[0];
        var then = elements[1];
        var otherwise;

        if (elements.length > 2) {
            otherwise = elements[2];
        } else {
            otherwise = null;
        }

        return { type: "ConditionalExpression", test: cond,
                 consequent: then, alternate: otherwise }
    }
};

// Type-checking --------------------------------------------------------------
var isNumber = function(o) {
    return !isNaN(parseFloat(o)) && isFinite(o);
};
var isNull = function(o) {
    return o === null;
};
var isString = function(o) {
    return Object.prototype.toString.call(o) === '[object String]';
};
var isBoolean = function(o) {
    return o === true || o === false;
};
var isSymbol = function(o) {
    return o.__alienscript_tag === "S";
};
var isSpecialForm = function(o) {
    return isSymbol(o) && special_forms[o.name] !== undefined;
};
var isPrimitive = function(o) {
    return isSymbol(o) && primitives[o.name] !== undefined;
};
var isMacro = function(o) {
    return isSymbol(o) && macros[o.name] !== undefined;
};
var isASTHunkAnExpression = function(ast) {
    // Return whether the given hunk of JS AST (something like
    // { type: 'Literal', value: 10 }) is an "Expression" hunk.  Literals and
    // lots of other stuff are expressions, but things like variable
    // declarations are not.
    //
    // Fuck this bullshit language.
    return contains(["Literal", "Identifier", "BinaryExpression",
                     "UnaryExpression", "ArrayExpression", "MemberExpression",
                     "ConditionalExpression", "FunctionExpression"],
                    ast.type);
};

// Grow -----------------------------------------------------------------------
//
// grow* functions are responsible for growning an Alienscript Abstract Syntax
// Shrub (ASS) into a Javascript Abstract Syntax Tree (AST).
//
// grow() is the main entry point here, and will take an arbitrary ASS and
// transform it into an AST.
var growSpecialForm = function(head, tail) {
    return special_forms[head.name](tail);
};
var growPrimitive = function(head, tail) {
    return primitives[head.name](map(grow, tail));
};
var growMacro = function(head, tail) {
    return apply(macros[head.name], tail);
};
var growApplication = function(head, tail) {
    return { type: "CallExpression",
             callee: grow(head), arguments: map(grow, tail) };
};
var grow = function(sexp) {
    if (isNumber(sexp)) {
        if (sexp < 0) {
            // Are you fucking kidding me, escodegen?
            return {
                type: "UnaryExpression", operator: "-", prefix: true,
                argument: { type: 'Literal', value: -(sexp) }
            };
        } else {
            return { type: 'Literal', value: sexp };
        }
    } else if (isNull(sexp) || isString(sexp) || isBoolean(sexp)) {
        return { type: 'Literal', value: sexp };
    } else if (isSymbol(sexp)) {
        return { type: 'Identifier', name: sexp.name };
    } else if (util.isArray(sexp)) {
        var head = sexp[0];
        var tail = slice(sexp, 1);

        if (isPrimitive(head)) {
            return growPrimitive(head, tail);
        } else if (isSpecialForm(head)) {
            return growSpecialForm(head, tail);
        } else if (isMacro(head)) {
            return grow(growMacro(head, tail));
        } else {
            return growApplication(head, tail);
        }
    } else {
        return 'unknown';
    }
};

// Parse ----------------------------------------------------------------------
//
// parse() reads a given file of Alienscript code and parses it into an Abstract
// Syntax Shrub (i.e.: series of sexps).
var parse = function(filename) {
    return alienparse.parse(fs.readFileSync(filename, 'utf8'));
};

// Main -----------------------------------------------------------------------
var context = function() {
    var ctx = vm.createContext();
    ctx['console'] = console;
    ctx['macros'] = macros;
    ctx['Symbol'] = Symbol;
    return ctx;
}
var compile = function(filename, ctx, verbose) {
    if (verbose) {
        console.log('// Parsing file ' + filename + ' -----------------------');
    }

    var ast = parse(filename);

    if (verbose) {
        console.log();
        console.log('// Alienscript ASS ---------------------------------');
        console.log(util.inspect(ast, false, null));
        console.log();
        console.log('// Javascript --------------------------------------');
        console.log();
    }

    for (var i = 0; i < ast.length; i++) {
        var jsast = grow(ast[i]);

        if (verbose) {
            console.log(util.inspect(jsast, false, null));
        }

        var jscode = escodegen.generate(jsast);

        console.log(jscode);

        var result = vm.runInContext(jscode, ctx);

        if (verbose) {
            console.log("// => " + result);
        console.log();
        }
    }
};
(function() {
    var ctx = context();
    compile('stdlib.alien', ctx, true);
    compile(process.argv[2], ctx, false);
})();

