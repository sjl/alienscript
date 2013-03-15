var vm = require('vm');
var fs = require('fs');
var util = require('util');
var alienparse = require("./alienparse");

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
var apply = function(fn, args) {
    return fn.apply(null, args);
};

// Macro definitions ----------------------------------------------------------
var macros = {
    "defn": function(name, args, body) {
        return [new Symbol('def'), name, [new Symbol('fn'), args, body]];
    }
};

// Special form definitions ---------------------------------------------------
var special_forms = {
    "fn": function(args, body) {
        args = map(eval, args);
        body = eval(body);

        return (
            "(function (" + args.join(', ') + ") " +
                "{ " +
                    "return " + body + ";" +
                " }" +
            ")");
    },
    ".": function(obj, method) {
        var args = slice(arguments, 2);

        return (
            "(" +
                "(" + eval(obj) + ")." + method.name +
                "(" + map(eval, args).join(', ') + ")" +
            ")");
    }
};

// Primitive definitions ------------------------------------------------------
var primitives = {
    "list": function(elements) {
        return "[" + elements.join(", ") + "]";
    },
    "+": function(elements) {
        return "(" + elements.join(" + ") + ")";
    },
    "*": function(elements) {
        return "(" + elements.join(" * ") + ")";
    },
    "/": function(elements) {
        return "(" + elements.join(" / ") + ")";
    },
    "-": function(elements) {
        if (elements.length === 1) {
            return "-(" + elements[0] + ")";
        } else {
            return "(" + elements.join(" - ") + ")";
        }
    },
    ">": function(elements) {
        return "(" + elements[0] + " > " + elements[1] + ")";
    },
    "<": function(elements) {
        return "(" + elements[0] + " < " + elements[1] + ")";
    },
    "get": function(elements) {
        var obj = elements[0];
        var idx = elements[1];

        return "(" + obj + "[" + idx + "]" + ")";
    },
    "def": function(elements) {
        var name = elements[0];
        var value = "null";
        if (elements.length > 1) {
            value = elements[1];
        }

        return "var " + name + " = " + value;
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

        return (
            "(" +
                "(" + cond + ")" +
                " ? " +
                "(" + then + ")" +
                " : " +
                "(" + otherwise + ")" +
            ")");
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

// Eval -----------------------------------------------------------------------
var evalSpecialForm = function(head, tail) {
    return apply(special_forms[head.name], tail);
};
var evalPrimitive = function(head, tail) {
    return primitives[head.name](map(eval, tail));
};
var evalMacro = function(head, tail) {
    return apply(macros[head.name], tail);
};
var evalApplication = function(head, tail) {
    return eval(head) + "(" + map(eval, tail).join(', ') + ")";
};
var eval = function(sexp) {
    if (isNumber(sexp)) {
        return sexp.toString();
    } else if (isNull(sexp)) {
        return 'null';
    } else if (isString(sexp)) {
        return util.format('%j', sexp);
    } else if (isBoolean(sexp)) {
        return sexp.toString();
    } else if (isSymbol(sexp)) {
        return sexp.name;
    } else if (util.isArray(sexp)) {
        var head = sexp[0];
        var tail = slice(sexp, 1);

        if (isPrimitive(head)) {
            return evalPrimitive(head, tail);
        } else if (isSpecialForm(head)) {
            return evalSpecialForm(head, tail);
        } else if (isMacro(head)) {
            return eval(evalMacro(head, tail));
        } else {
            return evalApplication(head, tail);
        }
    } else {
        return 'unknown';
    }
};

// Main -----------------------------------------------------------------------
var parse = function(filename) {
    return alienparse.parse(fs.readFileSync(filename, 'utf8'));
};
(function() {
    var ast = parse(process.argv[2]);
    console.log('// ast ---------------------------------------------');
    console.log(util.inspect(ast, false, null));

    console.log('\n// js ----------------------------------------------');
    var ctx = vm.createContext();

    for (var i = 0; i < ast.length; i++) {
        var jscode = eval(ast[i]) + ';';
        console.log(jscode);

        var result = vm.runInContext(jscode, ctx);
        console.log("// => " + result);

        console.log();
    }
})();

