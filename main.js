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

// Macro definitions ----------------------------------------------------------
var macros = {
    "defn": function(name, args, body) {
        return [new Symbol('def'), name, [new Symbol('fn'), args, body]];
    }
};

// Special form definitions ---------------------------------------------------
var special_forms = {
    "fn": function(elements) {
        var args = elements[0];
        var body = slice(elements, 1);

        args = map(eval, args);
        body = map(eval, body);

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
    ".": function(elements) {
        var obj = elements[0];
        var method = elements[1];
        var args = slice(elements, 2);

        obj = eval(obj);
        args = map(eval, args);
        method = { type: "Literal", value: eval(method).name };

        return { type: "CallExpression", callee: {
                    type: "MemberExpression", computed: true,
                    object: obj, property: method,
                 }, arguments: args };
    },
    "quote": function(elements) {
        var q = elements[0];
        console.log(q);
        return q;
    },
    "defmacro": function(elements) {
        var name = elements[0];
        var fnexpr = slice(elements, 1)

        name = eval(name).name;

        return { type: "AssignmentExpression", operator: "=",
                 left: { type: "MemberExpression", computed: true,
                         object: { type: "Identifier", name: "macros" },
                         property: { type: "Literal", value: name } },
                 right: special_forms['fn'](fnexpr) };
    },
    "symbol": function(elements) {
        var name = elements[0];
        name = eval(name).name;
        return { type: "NewExpression",
                 callee: { type: "Identifier", name: "Symbol" },
                 arguments: [{ type: "Literal", value: name }] };
    }
};

// Primitive definitions ------------------------------------------------------
var primitives = {
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
    // declarations are not.  Fuck this bullshit language.
    return contains(["Literal", "Identifier", "BinaryExpression",
                     "UnaryExpression", "ArrayExpression", "MemberExpression",
                     "ConditionalExpression", "FunctionExpression"],
                    ast.type);
};

// Eval -----------------------------------------------------------------------
var evalSpecialForm = function(head, tail) {
    return special_forms[head.name](tail);
};
var evalPrimitive = function(head, tail) {
    return primitives[head.name](map(eval, tail));
};
var evalMacro = function(head, tail) {
    return apply(macros[head.name], tail);
};
var evalApplication = function(head, tail) {
    return { type: "CallExpression",
             callee: eval(head), arguments: map(eval, tail) };
};
var eval = function(sexp) {
    // eval(sexp) takes the sexp and transforms it into a JS AST, suitable for
    // use with escodegen
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

    // console.log('// alienscript ast ---------------------------------------');
    // console.log(util.inspect(ast, false, null));

    console.log('\n// JAVASCRIPT ------------------------------------------\n');
    var ctx = vm.createContext();
    ctx['console'] = console;
    ctx['macros'] = macros;
    ctx['Symbol'] = Symbol;

    for (var i = 0; i < ast.length; i++) {
        var jsast = eval(ast[i]);
        // console.log(util.inspect(jsast, false, null));

        var jscode = escodegen.generate(jsast);
        console.log(jscode);

        var result = vm.runInContext(jscode, ctx);
        console.log("// => " + result);

        console.log();
    }
})();

