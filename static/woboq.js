// ==UserScript==
// @name           code.woboq.org integration into arbitrary websites
// @description    Easy access to code.woboq.org from Qt's gerrit
// @author         Olivier Goffart <ogoffart@woboq.com>, Markus Goetz <markus@woboq.com>
// @license        MIT
// @match          *
// @include        *
// @grant          none
// ==/UserScript==

window.addEventListener('load', function(){
"use strict";

// Config options
var codeDiv = document.getElementById("box");
var root_path = "https://code.woboq.org/";
var default_project = "qt5";
var api_path = "https://code.woboq.org/api/";
// FIXME how to make generic?
var symbol_path = "https://code.woboq.org/data/symbol.html?root=../qt5&ref="; // FIXME

//-----------------------------------------------------------------------------
// Utility functions

// function escapeRegExp(string) {
//     return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
// }

function escapeHtml(string) {
    return string.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// function unescapeHtml(string) {
//     return string.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
//         .replace(/&quot;/g, '"').replace(/&apos;/g, "&apos;").replace(/&amp;/g, "&");
// }

// function hasClass(elem, className) {
//     return elem.className.split(' ').indexOf(className) > -1;
// }

// Get the hash of a function for the lookup  (copied from codebrowser.js)
// function getFnNameKey(request) {
//     if (request.indexOf('/') != -1 || request.indexOf('.') != -1)
//         return false;
//     var mx = request.match(/::([^:]{2})[^:]*$/);
//     if (mx)
//         return mx[1].toLowerCase().replace(/[^a-z]/, '_');
//     request = request.replace(/^:*/, "");
//     if (request.length < 2)
//         return false;
//     var k = request.substr(0, 2).toLowerCase();
//     return k.replace(/[^a-z]/, '_');
// }

// return absolude position of a dom node (in a object with 'top' and 'left'  properties)
// function getAbsolutePos(elem) {
//     var left = 0;
//     var top = 0;
//     while (elem) {
//         left += elem.offsetLeft;
//         top += elem.offsetTop;
//         elem = elem.offsetParent;
//     }
//     return {top: top,left: left};
// }

    // demangle the function name, don't care about the template or the argument
    function demangleFunctionName(mangle) {
        if (! mangle) return mangle;
        if (mangle[0] !== '_') return mangle;
        if (mangle[1] === 'M' && mangle[2] === '/') return mangle.slice(3);
        if (mangle[1] !== 'Z') return mangle;
        mangle = mangle.slice(2);
        var result;
        var last = "";
        var scoped = false;
        do {
            if (!result)
                result = "";
            else
                result += "::";
            if (mangle[0]==='D') {
                result += "~" + last;
                break;
            }
            if (mangle[0]==='C') {
                result += last;
                break;
            }
            if (mangle[0]==='N') {
                mangle = mangle.slice(1);
                scoped = true;
            }
            if (mangle[0]==='K') mangle = mangle.slice(1);
            if (mangle[0]==='L') mangle = mangle.slice(1);
            if (mangle.match(/^St/)) { //St
                mangle = mangle.slice(2);
                result += "std::";
            }
            if (mangle[0]==='I') {
                var n = 1;
                var i;
                for (i = 1; i < mangle.length && n > 0 ;i++) {
                    if (mangle[i] === 'I') n++;
                    if (mangle[i] === 'E') n--;
                }
                mangle = mangle.slice(i);
            }
            if (mangle.match(/^[a-z]/)) {
                result += "operator";
                break;
            }
            var len = parseInt(mangle);
            if (!len) return null;
            var start = ("" + len).length;
            last = mangle.substr(start, len);
            result += last;
            mangle = mangle.slice(start + len)
        } while(mangle && mangle[0]!='E' && mangle[0]!='B' && scoped);
        return result;
    }


function getTooltipPos(event) {
    return {top: event.clientY,left: event.clientX};
    //return {top: event.screenY,left: event.screenX};
}


//-----------------------------------------------------------------------------
// Popup

var curentFnName = ""; // the fnName for which the popup is shown or that we are trying to load
var currentXmlHttpRequest = null;


var popup = document.getElementById('woboq_popup');
if (!popup) {
        popup = document.createElement('div');
        popup.id = 'woboq_popup';
        document.body.appendChild(popup);
}
var hideTimer = 0;
function clearPopupHideTimer() {
    if (hideTimer > 0) {
        window.clearTimeout(hideTimer);
    }
}
function resetPopupHideTimer() {
    // start/reset timer to 3 sec
    clearPopupHideTimer();
    hideTimer = window.setTimeout(closePopup, 3000);
}
popup.addEventListener( 'mouseleave', function (event) {
    resetPopupHideTimer();
});
popup.addEventListener( 'mouseenter', function (event) {
    clearPopupHideTimer();
});


    function createPopupHtml(pos, content) {
        console.log(pos.top);
    return "<div style='"
        +"padding:1em; padding-top:1ex; border: 1px solid gray; background-color: white;"
        +"font-size: smaller; opacity: 0.9; border-radius: 4px;"
        +"max-width: 80%; box-shadow:1px 1px 7px gray; z-index:2;"
        +"overflow-y:auto; max-height: 300px;"
        +"position: fixed;"
        +"top:" + (pos.top) + "px;"
        +"left:"+ (pos.left) +"px;"
        +"'>" + content + "</div>";
}

function closePopup() {
    curentFnName = "";
    //if (currentXmlHttpRequest)
    //    currentXmlHttpRequest.abort(); // FIXME shall we really? isn't it better to cache?
    var popup = document.getElementById('woboq_popup');
    if (popup && popup.hasChildNodes())
        popup.removeChild(popup.childNodes[0]);
}

// FIXME: Would be better for latency if the search API function automatically returns the data
// so one request could be avoided
function showRefPopup(ref, pos, fnName, project) {
    curentFnName = fnName;
    var xhr = new XMLHttpRequest();
    project = project ? project : default_project;
    xhr.open('GET', root_path + project + "/refs/" + ref);
    xhr.onload = function() {
        if (xhr.status !== 200)
            return;
        if (curentFnName !== fnName)
            return;
        var xml = (new window.DOMParser()).parseFromString(
                    "<data>"+xhr.responseText+"</data>", "text/xml");
        if (!xml || !xml.childNodes || !xml.childNodes[0] || !xml.childNodes[0].childNodes)
            return;

        var type = "";
        var url = "";
        var defList = [];
        var useCount = 0;

        var nodes = xml.childNodes[0].childNodes;
        for (var i = 0; i < nodes.length; ++i) {
            var n = nodes[i];
            if (!n || !n.tagName) continue;
            if (n.tagName === "def") {
                if (!type && n.hasAttribute("type")) {
                    type = n.getAttribute("type");
                }
                if (!url && n.hasAttribute("f")) {
                    url = root_path + project + "/" + n.getAttribute("f") + ".html#" + ref;
                }
            } else if (n.tagName === "use") {
                useCount++;
            }
        }

        if (url && type) {
            var popup = document.getElementById('woboq_popup');
             var html = "";
            html += "<p style='color:#061'>" + escapeHtml(type) + "</p>";
            html += "<p><a style='color:#037' href='" + escapeHtml(url) + "'>Go to definition</a>";

            html += "<br /><a style='color:#037' href='" + escapeHtml(symbol_path + ref)
                + "#uses'>Show uses (" + useCount + ")</a></p>";
            popup.innerHTML = createPopupHtml(pos, html);
            resetPopupHideTimer();
        }
    };
    xhr.send();
    currentXmlHttpRequest = xhr;
}

/*
// hovering ofer 'elem' node that contains a path to 'file'
function hoverFile(elem, file, project) {
    elem.woboq_done = true;
    var xhr = new XMLHttpRequest();
    project = project ? project : default_project;
    xhr.open('GET', root_path + project + "/fileIndex");
    xhr.onload = function() {
        var possible_files = [];
        if (xhr.status === 200) {
            var allFiles = xhr.responseText.split("\n");
            for (var i = 0; i < allFiles.length; ++i) {
                if (allFiles[i].indexOf(file) >= 0)
                    possible_files.push(allFiles[i]);
            }
        }
        possible_files.sort(function(a, b) { return a.length - b.length; });
        if (possible_files.length > 0) {
            elem.innerHTML = "<a style='"
                + "color:inherit;"
//                + "background-image: url(https://woboq.com/favicon.ico);"
//                + "background-position: right;"
//                + "background-repeat: no-repeat;"
//                + "padding-right: 20px;"
                + "' href='" + root_path + project + "/"+ escapeHtml(possible_files[0]) +".html'>"
                + elem.innerHTML + "</a>";
        }
    };
    xhr.send();
}
*/




var woboq_previousMouseMove = "";
function tooltipfunc (event) {
    //if (event.target.tagName == "body" || event.target == woboq_previousMouseMove)
    //    return;
    if (event.target.woboq_done)
        return;

    woboq_previousMouseMove = event.target;
    //console.log("MOVE LISTENER ->" + event.target.tagName);
    //console.log("WORD LISTENER ->" + event.screenX);
    //console.log("WORD LISTENER ->" + event.clientX);

    // FIXME: Maybe try http://stackoverflow.com/a/30606508/2941 instead
    // function getHitWord(hit_elem) {
    //     var hit_word = '';
    //     hit_elem = $(hit_elem);
    //
    //     //text contents of hit element
    //     var text_nodes = hit_elem.contents().filter(function(){
    //         return this.nodeType == Node.TEXT_NODE && this.nodeValue.match(/[a-zA-Z:_0-9]{2,}/)
    //     });
    //     console.log(text_nodes);
    //
    //     //bunch of text under cursor? break it into words
    //     if (text_nodes.length > 0) {
    //         var original_content = hit_elem.clone();
    //
    //         //wrap every word in every node in a dom element
    //         text_nodes.replaceWith(function(i) {
    //             return $(this).text().replace(/([a-zA-Z-:_0-9]*)/g, "<word>$1</word>")
    //         });
    //         console.log(text_nodes);
    //
    //         //get the exact word under cursor
    //         var hit_word_elem = document.elementFromPoint(event.clientX, event.clientY);
    //
    //         if (hit_word_elem.nodeName != 'WORD') {
    //             console.log("missed!");
    //         }
    //         else  {
    //             hit_word = $(hit_word_elem).text();
    //             console.log("got it: "+hit_word);
    //         }
    //
    //         hit_elem.replaceWith(original_content);
    //     }
    //
    //     return hit_word;
    // }
    //
    // var hit_word = getHitWord(document.elementFromPoint(event.clientX, event.clientY));
// This code make it works with IE
// REF: http://stackoverflow.com/questions/3127369/how-to-get-selected-textnode-in-contenteditable-div-in-ie
    function getTextRangeBoundaryPosition(textRange, isStart) {
        var workingRange = textRange.duplicate();
        workingRange.collapse(isStart);
        var containerElement = workingRange.parentElement();
        var workingNode = document.createElement("span");
        var comparison, workingComparisonType = isStart ?
            "StartToStart" : "StartToEnd";

        var boundaryPosition, boundaryNode;

        // Move the working range through the container's children, starting at
        // the end and working backwards, until the working range reaches or goes
        // past the boundary we're interested in
        do {
            containerElement.insertBefore(workingNode, workingNode.previousSibling);
            workingRange.moveToElementText(workingNode);
        } while ( (comparison = workingRange.compareEndPoints(
            workingComparisonType, textRange)) > 0 && workingNode.previousSibling);

        // We've now reached or gone past the boundary of the text range we're
        // interested in so have identified the node we want
        boundaryNode = workingNode.nextSibling;
        if (comparison == -1 && boundaryNode) {
            // This must be a data node (text, comment, cdata) since we've overshot.
            // The working range is collapsed at the start of the node containing
            // the text range's boundary, so we move the end of the working range
            // to the boundary point and measure the length of its text to get
            // the boundary's offset within the node
            workingRange.setEndPoint(isStart ? "EndToStart" : "EndToEnd", textRange);

            boundaryPosition = {
                node: boundaryNode,
                offset: workingRange.text.length
            };
        } else {
            // We've hit the boundary exactly, so this must be an element
            boundaryPosition = {
                node: containerElement,
                offset: getChildIndex(workingNode)
            };
        }

        // Clean up
        workingNode.parentNode.removeChild(workingNode);

        return boundaryPosition;
    }
    function getWordUnderCursor(event) {
        var range, textNode, offset;

        if (document.body.createTextRange) {           // Internet Explorer
            try {
                range = document.body.createTextRange();
                range.moveToPoint(event.clientX, event.clientY);
                range.select();
                range = getTextRangeBoundaryPosition(range, true);

                textNode = range.node;
                offset = range.offset;
            } catch(e) {
                return "";
            }
        }
        else if (document.caretPositionFromPoint) {    // Firefox
            range = document.caretPositionFromPoint(event.clientX, event.clientY);
            textNode = range.offsetNode;
            offset = range.offset;
        } else if (document.caretRangeFromPoint) {     // Chrome
            range = document.caretRangeFromPoint(event.clientX, event.clientY);
            textNode = range.startContainer;
            offset = range.startOffset;
        }

        //data contains a full sentence
        //offset represent the cursor position in this sentence
        var data = textNode.data,
            i = offset,
            begin,
            end;
        if (!data)
            return "";

        function isBoundary(char) {
            return char==" "||char=="\n"||char=="("||char==")"||char=="}"
                ||char=="{"||char=="."||char=="-"||char==">"||char=="<"
                ||char=="*"||char==";"||char=="/"||char=="}";
        }
        function isSymbol(char) {
            if (char == null)return false;
            return char.match(/[a-zA-Z:_0-9]/);
        }
//console.log("TEXT NODE DATA", data);
        //Find the begin of the word (space)
        while (i > 0 && isSymbol(data[i])) { --i; };
        begin = i;

        //Find the end of the word
        i = offset;
        while (i < data.length && isSymbol(data[i])) { ++i; };
        end = i;

        //Return the word under the mouse cursor
        return data.substring(begin, end).trim();
    }

    //Get the HTML in a div #hoverText and detect mouse move on it
    var $hoverText = $("#hoverText");
    $hoverText.mousemove(function (e) {
        var word = getWordUnderCursor(e);

        //Show the word in a div so we can test the result
        if (word !== "")
            $("#testResult").text(word);
    });


    var hit_word = getWordUnderCursor(event);
    console.log("WORD LISTENER ->" + hit_word);


    // Ignore clicks on the popup
    // var parent = event.target;
    // if (!parent)return;
    // while (parent) {
    //     if (parent.id === "woboq_popup")
    //         return;
    //     parent = parent.parentNode;
    // }

    // FIXME: Could be used to define a "client area" where we match
    //var selection = window.getSelection();
    //var target = selection.anchorNode;
    //if (target !== selection.focusNode)
    //    return closePopup();  // only do the matching if the selection is in one line
    // if (!hasClass( target.parentNode, 'diffText')
    //         && !hasClass( target.parentNode.parentNode, 'diffText')
    //         && !hasClass( target.parentNode.parentNode.parentNode, 'diffText')
    //         && !hasClass( target.parentNode, 'fileLine')
    //         && !hasClass( target.parentNode.parentNode, 'fileLine')
    //         && !hasClass( target.parentNode.parentNode.parentNode, 'fileLine'))
    //     return closePopup();  // not part of the diff

    //var data = ""+target.data;
    //var data = hit_word;
    // if (data.length < 2)
    //     return closePopup(); // FIXME: Filter out int bool void etc
    // var begin = Math.min(selection.anchorOffset, selection.focusOffset);
    // var end = Math.max(selection.anchorOffset, selection.focusOffset);
    // // extend the selection to the beginning of the token
    // while(begin > 0 && data[begin-1].match((/[a-zA-Z0-9_:]/)))
    //     begin--;
    // while(end < data.length && data[end].match((/[a-zA-Z0-9_:]/)))
    //     end++;

    //var fnName = data.substr(begin, end-begin);
    var fnName = demangleFunctionName(hit_word);

    // FIXME Maybe we don't need this
    //extend the selection to the begining of the token if it is in another html node
    // var node = target.parentNode.previousSibling;
    // if (!node) node = target.parentNode.parentNode.previousSibling;
    // while (begin === 0 && node) {
    //     data = node.innerText;
    //     if (!data)
    //         break;
    //     begin = data.length;
    //     while(begin > 0 && data[begin-1].match((/[a-zA-Z0-9_:]/)))
    //         begin--;
    //     fnName = data.substr(begin) + fnName;
    //     node = node.previousSibling;
    // }
    //and to the end
    // node = target.parentNode.nextSibling;
    // if (!node) node = target.parentNode.parentNode.nextSibling;
    // data = ""+target.data;
    // while (end === data.length && node) {
    //     data = node.innerText;
    //     if (!data)
    //         break;
    //     end = 0;
    //     while(end < data.length && data[end].match((/[a-zA-Z0-9_:]/)))
    //         end++;
    //     fnName = fnName + data.substr(0, end);
    //     node = node.nextSibling;
    // }

    if (fnName === curentFnName) {
        return; // popup already there
    } else {
        //closePopup();
    }

    if (fnName.match(/[^a-zA-Z0-9_:]/))
        return;
    if (!fnName || fnName == "")
        return;

    // var k = getFnNameKey(fnName);
    // if (!k)
    //     return;
    var k = fnName;
    curentFnName = fnName;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', api_path + "fn/" + k);
    xhr.onload = function() {
        if (curentFnName !== fnName)
            return;

        if (xhr.status !== 200)
            return;

        var possibilities = JSON.parse(xhr.response);
        if (possibilities.length > 1) {
            // Several possibilities, show a choice menu
            var popup = document.getElementById('woboq_popup');
            var html = "<ul style='margin:0; padding:1em;'>";
            for(var i = 0; i < possibilities.length; ++i) {
                // html += "<li data-ref='" + escapeHtml(possibilities[i].ref) + "'>"
                //     + escapeHtml(possibilities[i].name) +"</i>";
                url = possibilities[i].url;
                var project = url.replace(/^.*\/\/.*?\/(.*?)\/.*/, "$1"); // FIXME: This won't work for other structures than code.woboq.org/$PROJECT
                var filename = url.replace(/^.*\/([^\/]*)#.*$/, "$1");
                html += "<li><a href='" + url + "'>"+ possibilities[i].name+ "</a> ("+ project +" " +filename+")</li>";
            }
            html += "</ul>";
            popup.innerHTML = createPopupHtml(getTooltipPos(event), html);
            resetPopupHideTimer();
        } else if (possibilities.length == 1) {
            //showRefPopup(possibilities[0].ref, getAbsolutePos(target.parentNode), fnName);
            var url = possibilities[0].url;
            var ref = url.replace(/^.*#(.*)$/, "$1");
            var project = url.replace(/^.*\/\/.*?\/(.*?)\/.*/, "$1"); // FIXME: This won't work for other structures than code.woboq.org/$PROJECT
            showRefPopup(ref, getTooltipPos(event), fnName, project);
        }
    };
    xhr.send();
    currentXmlHttpRequest = xhr;
};

codeDiv.addEventListener( 'mousemove', tooltipfunc, false );
codeDiv.addEventListener( 'click', tooltipfunc, false );


window.addEventListener('hashchange', closePopup);


});
