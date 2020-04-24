import { Marker, IntOrRange, getMarkerStyleType, MarkerStyleType } from './marker';
import { lexer  } from './lexer';
import { ParserError, StyleBlockBase, PushErrorFunction,
				 parseIntOrRange, sortStyleBlocks
			 } from './parser_utils';
import { StyleBlockFootnote, parseFootnote } from './parser_footnotes';
import { StyleBlockCrossRef, parseCrossRef } from './parser_crossref';
import AwokenRef, { BibleRef } from 'awoken-bible-reference';

export interface TableOfContentsEntry {
	/** toc1 - eg: The Gospel According to Matthew*/
	long_text?: string,

	/** toc2 - eg: Matthew */
	short_text?: string,

	/** toc3 - eg: Mat */
	abbreviation?: string,
};

/**
 * Represents set of data for markers which can be used in multiple
 * levels, eg, \mt1, \mt2, etc
 */
type LeveledData<T> = {
	[ index: number ] : T;
};

/**
 * Represents any StyleBlock with no additional data section
 * for example paragraphs
 */
interface StyleBlockNoData extends StyleBlockBase{
	kind : (
		// paragraphs: https://ubsicap.github.io/usfm/paragraphs/
	  "p" | "m" | "po" | "pr" | "cls" | "pi" | "mi" | "nb" | "pc" | "ph" |
		// embedded paragrahs: https://ubsicap.github.io/usfm/paragraphs/
	  "pmo" | "pm" | "pmc" | "pmr" |
    // poetry: https://ubsicap.github.io/usfm/poetry/
		"qa" | "qr" | "qc" | "qd" | "qac" | "qs" |
		// lists: https://ubsicap.github.io/usfm/lists/index.html#lh
	  "lh" | "lf"	| "litl" | "lik" |
		//https://ubsicap.github.io/usfm/tables/index.html
		"tr" |
		// Word level attributes - https://ubsicap.github.io/usfm/attributes/index.html
		'add' | 'bk' | 'dc' | 'k' | 'lit' | 'nd' | 'ord' | 'pn' | 'png' | 'addpn' |
		'qt' | 'sig' | 'sls' | 'tl' | 'wj' | 'em' | 'bd' | 'it' | 'bdit' | 'no' |
		'sc' | 'sup' | 'ndx' | 'rb' | 'pro' | 'w' | 'wg' | 'wh' | 'wa' | 'fig' | 'vp' |
		// titles, headings, labels: https://ubsicap.github.io/usfm/titles_headings/index.html
		'sr' | 'r' | 'rq' | 'd' |	'sp' | 'sd' |
	  // misc
	  "b" // blank line (between paragraphs or poetry)
	);
};

interface StyleBlockHeading extends StyleBlockBase {
	kind: 's' | 'sd' | 'ms',

	/**
	 * level of division for the section heading
	 */
	level: number,
};

/**
 * Represents a region of text making up a single verse
 */
interface StyleBlockVerse extends StyleBlockBase{
	kind : "v";

	// The BibleRef of the text in this verse
	// Note that this may be a BibleRange rather than just BibleVerse instance,
	// since some (usually less literal) translations sometimes merge verses together
	// into a single flowing sentence
	ref : BibleRef;
};

interface StyleBlockIndented extends StyleBlockBase {
	kind : "q" | "qm" | "pi" | "ph" | "li" | "lim";

	indent : number,
}

interface StyleBlockColumn extends StyleBlockBase {
	// https://ubsicap.github.io/usfm/lists/index.html#liv-liv
	// https://ubsicap.github.io/usfm/tables/index.html#th
	//
	// Represents elements with an associated column number,
	// eg in tables or key/value lists
	kind: "liv" | "th" | "thr" | "tc" | "tcr";

	column: IntOrRange,
}

interface StyleBlockVirtual extends StyleBlockBase {
	// Virtual style blocks do not actually exist as markers in the USFM
	// but are automatically generated by the parser to group related
	// items, for example a wrapper around an entire list or entire table
	// This is useful for later HTML generation where such elements are
	// required
	//
	kind: // wraps a set of contigious \tr elements
	      "table" |

		    // wraps a set of contigious \li elements, optionally including a lh and lf (header and footer)
		    "list" |

		    // wraps a set of contigious \li elements, but never containing a lh or lf
		    "list_items";

	is_virtual: true,
};

type StyleBlock = (StyleBlockNoData    |
									 StyleBlockVerse     |
									 StyleBlockIndented  |
									 StyleBlockColumn    |
									 StyleBlockVirtual   |
									 StyleBlockFootnote  |
									 StyleBlockCrossRef  |
									 StyleBlockHeading
									);

interface ParseResultBody {
	/**
	 * The full text of the parsed chapter without any styling, line breaks, etc
	 */
	text : string;

	/**
	 * Regions of styling for `text`
	 */
	styling : StyleBlock[],
};

interface ParseResultChapterSuccess {
	success : true;

	errors  : ParserError[];

	/** Chapter number, as specified by \c tag */
	chapter : number;

	/** Alternative chapter number, as specified by \ca */
	chapter_alt? : number;

	/** The name used to represent the chapter, rather than just
	 * using the book's chapter label postfixed by the number
	 * eg \cl Psalm One, rather than the autogenerated "Chapter 1"
	 * or "Psalm 1" if the book's chapter_label is set
	 */
	label?: string;

	/**
	 * Initial character to be printed larger than rest of text
	 * at the very start of the text
	 */
	drop_cap? : string;

	/**
	 * Extra text added by translators before main verse content
	 */
	description?: string;

	/**
	 * Content of this chapter
	 */
	body : ParseResultBody;
};


type ParseResultChapter = {
	success: false,
	errors : ParserError[],
} | ParseResultChapterSuccess;


interface ParseResultBookSuccess {
	success : true,

	errors  : ParserError[],

	/** The book id, as determined by \id tag */
	book_id?: string,

	/** The extra text content following the \id tag */
	id_text?: string,

	/** Encoding, as specified by the \ide tag */
	encoding?: string,

	/** Table of contents data */
	toc  : TableOfContentsEntry,

	/** Alternative table of contents data */
	toca : TableOfContentsEntry,

	/** String representing the usfm version as per the \usfm tag */
	usfm_version? : string,

	/**
	 * Running header text, usualy rendered as text at the
	 * top of each page
	 */
	running_header?: string,

	/**
	 * Represents the label to be used in place of the word "Chapter"
	 * For example, Rather than a heading of "Chapter 5", inside Psalms
	 * printed bibles often instead have a heading of "Psalms 5"
	 */
	chapter_label? : string,

	/**
	 * Major title data
	 */
	major_title : LeveledData<string>;

	/** The parse result for each chapter in the book */
	chapters: ParseResultChapter[],
};

export type ParseResultBook = {
	success : false,
	errors  : ParserError[],
} | ParseResultBookSuccess;

/**
 * Parses a complete USFM file
 */
export function parse(text: string) : ParseResultBook {
	let headers = [];

	let lex_iter : IterableIterator<Marker> = lexer(text);

	let result : ParseResultBookSuccess = {
		success     : true,
		toc         : {},
		toca        : {},
		major_title : {},
		chapters    : [],
		errors      : [],
	};

	function pushError(marker : Marker, message: string){
		result.errors.push({ message, marker });
	}

	let parsing_headers = true;
	let parsing_study_content = false;

	let marker_yield_val : IteratorResult<Marker>;
	let marker : Marker = { kind: '' };
	while(parsing_headers){
		marker_yield_val = lex_iter.next();
		if(marker_yield_val.done){ return result; }
		marker = marker_yield_val.value;

		if(parsing_study_content){
			if(marker.kind === 'c'){
				parsing_headers = false;
			}
			continue;
		}

		switch(marker.kind){
			case 'id':
				result.book_id = marker.data;
				result.id_text = marker.text;
				break;
			case 'ide':
				result.encoding = marker.data;
				break;
			case 'toc':
				_assignTocValue(result.toc,  marker, pushError);
				break;
			case 'toca':
				_assignTocValue(result.toca, marker, pushError);
				break;
			case 'h':
				if(marker.level !== undefined){
					pushError(marker, "Skipping deprecated \h# marker");
				} else {
					result.running_header = marker.text;
				}
				break;
			case 'mt':
				try {
					let level = _levelOrThrow(marker, pushError);
					_assignLeveledData(result.major_title, level, marker.text)
				} catch (e) {}
				break;
			case 'cl':
				result.chapter_label = marker.text;
				break;
			case 'c':
				parsing_headers = false;
				break;
			case 'ip':
			case 'is':
			case 'bk':
			case 'ili':
				// :TODO: extended study content introduction sections and paragraphs are
				// skipped for now
				parsing_study_content = true;
				break;
			default:
				pushError(marker, "Unexpected marker in book header section");
				return { success: false,
								 errors : result.errors
							 };

		} // end of switch marker.kind
	}

	if(result.book_id === undefined){
		pushError(marker, "End of book header but ID was not found, using value '???'");
		result.book_id = '???';
	}

	//////////////////////////////
	// Read the remaining markers from lexer, splitting them into
	// an array of arrays, where each sub array is all the markers
	// for a single chapter
	let cur             : Marker[]   = [marker];
	let chapter_markers : Marker[][] = [cur];
	for(let m of lex_iter){
		if(m.kind === 'c'){
			cur = [m];
			chapter_markers.push(cur);
		} else {
			cur.push(m);
		}
	}

	//////////////////////////////
	// Actually parse the chapters
	result.chapters = chapter_markers.map(x => chapterParser(x, result.book_id!));

	return result;
}

/**
 * Internal function which parses the USFM for a single chapter, including any header markers
 * such as chapter title, description, etc
 *
 * @private
 *
 * @param  - markers - Array of markers to process  (IE: the lexed tokens for this parser)
 * @param  - book_id - The book being parsed, used to generate appropriate [[BibleRef]]'s
 */
function chapterParser(markers : Marker[], book_id : string) : ParseResultChapter {

	if(markers[0].kind !== 'c'){
		throw new Error("First marker in chapterParser must be of kind \\c");
	}

	let result : ParseResultChapterSuccess = {
		success : true,
		errors  : [],
		chapter : parseInt(markers[0].data!),
		body    : {
			text: '',
			styling: [],
		},
	};
	markers.shift(); // remove the \c marker

	function pushError(marker: Marker, message: string) : void {
		result.errors.push({ marker, message });
	}

	let marker : Marker | undefined;
	let m_idx = 0;
	for(let parsing_headers = true;
			m_idx < markers.length && parsing_headers;
			++m_idx
		 ){
		let marker = markers[m_idx];
		switch(marker.kind){
			case 'ca':
				if(!marker.closing){
					result.chapter_alt = marker.text ? parseInt(marker.text) : undefined;
				}
				break;
			case 'cl':
				result.label = marker.text;
				break;
			case 'cp':
				result.drop_cap = marker.text;
				break;
			case 'cd':
				result.description = marker.text;
				break;
			default:
				parsing_headers = false;
				--m_idx;
				break;
		} // end of switch marker.kind
	}

	result.body = bodyParser(markers.slice(m_idx), pushError, book_id, result.chapter);

	return result;
}

const BODY_SUB_PARSERS : {
	[index: string] : (m: Marker[], p: PushErrorFunction, m_idx: number, book: string, chapter: number) => [number, StyleBlock, string];
} = {
	'f'  : parseFootnote,
	'fe' : parseFootnote,
	'x'  : parseCrossRef,
};

/**
 * Internal function which parses the main body of a single chapter of a USFM file
 * @private
 *
 * @param markers      - Array of markers to process (IE: the lexed tokens for this parser)
 * @param pushError    - Function which should be used to indicate an error has occured during parsing
 * @param book_id      - The id of the book being parsed (used to generate [[BibleRef]]'s for verse
 *                       markers, hence can set to any value if these not needed)
 * @param chapter_num  - The chapter number being parsed (used to generate [[BibleRef]]'s for verse
 *                       markers, hence can be set to any value if these not needed)
 *
 */
function bodyParser(markers : Marker[],
										pushError : (m: Marker, e: string) => void,
										book_id: string, chapter_num: number
									 ) : ParseResultBody {

	let result : ParseResultBody = {
		text    : '',
		styling : [],
	};

	// maps marker kinds (eg p for \p) to the currently open block
	// of that type. Note that we cheat and group certain mutually exclusive tags
	// eg, a \qr marker (poetry right aligned) will automatically close as
	// \q1 marker (poetry left aligned, indent 1) tag, thus we store both
	// as simply 'q' in this map
	let cur_open : { [index: string] : StyleBlock } = {};

	// utility function that closes a currently open block
	function closeTagType(kind : string, t_idx : number){
		if(cur_open[kind]){
			cur_open[kind].max = t_idx;
			if(cur_open[kind].attributes === undefined){
				delete cur_open[kind].attributes;
			}
			result.styling.push(cur_open[kind]);
			delete cur_open[kind];
		}
	}

	// utility function that closes all currently open character or note
	// markers
	function closeCharacterMarkers(t_idx: number){
		for(let k in cur_open){
			if(k === 'v'){
				// Verses are only closed by verses
				continue;
			}
			let style_type = getMarkerStyleType(cur_open[k].kind);
			if(style_type === MarkerStyleType.Character ||
				 style_type === MarkerStyleType.Note){
				closeTagType(k, t_idx);
			}
		}
	}

	for(let m_idx = 0; m_idx < markers.length; ++m_idx){
		let marker : Marker = markers[m_idx];
		let t_idx = result.text.length;

		///////////////////////////////
		// See if we need to switch to a specific sub parser
		if(BODY_SUB_PARSERS[marker.kind] !== undefined){
			let [ new_m_idx, block, next_text ] = BODY_SUB_PARSERS[marker.kind](markers, pushError, m_idx, book_id, chapter_num);
			block.min = t_idx;
			block.max = t_idx;
			result.styling.push(block);
			result.text += next_text;
			m_idx = new_m_idx;
			continue;
		}

		///////////////////////////////
		// Before actually parsing tags, deal with "virtual" tags. These are tags
		// we automatically insert (but do not actually exist in USFM spec) in order
		// to contain a set of table rows or list elements. Useful when rendering as HTML
		//
		// Skip this logic if type is verse, since verse hierachies can
		// span any other type of hierachy
		if(marker.kind !== 'v'){

			if(marker.kind === 'tr'){
				if(cur_open['table'] === undefined){
					cur_open['table'] = { kind: "table", min: t_idx, max: t_idx,
																is_virtual: true
															};
				}
			} else if (['tc', 'tcr', 'th', 'thr'].indexOf(marker.kind) >= 0) {
				// no-op
			} else {
				closeTagType('table', t_idx);
			}

			if(marker.kind === 'lh'){
				// close open lists in case we have lists back to back seperated only by \lh
				closeTagType('list', t_idx);
				cur_open['list'] = { kind: "list", min: t_idx, max: t_idx,
														 is_virtual: true
													 };
			} else if (marker.kind === 'li' || marker.kind === 'lim'){
				if(cur_open['list'] === undefined){
					cur_open['list'] = { kind: "list", min: t_idx, max: t_idx,
															 is_virtual: true
														 };
				}

				if(cur_open['list_items'] === undefined){
					cur_open['list_items'] = { kind: "list_items", min: t_idx, max: t_idx,
																		 is_virtual: true
																	 };
				}
			} else if (['litl', 'lik', 'liv'].indexOf(marker.kind) >= 0) {
				// no-op
			} else {
				closeTagType('list_items', t_idx);
				if(marker.kind !== 'lf'){
					closeTagType('list', t_idx);
				}
			}
		}

		///////////////////////////////
		// Automatically close character markers when...
		let marker_style_type = getMarkerStyleType(marker.kind);
		if(marker_style_type === MarkerStyleType.Paragraph){
			// ....currently open paragraph changes
			closeCharacterMarkers(t_idx);
		} else if (marker_style_type === MarkerStyleType.Character ||
							 marker_style_type === MarkerStyleType.Note
							) {
			// ...a new character environment (which is not nested) is opened
			if(marker.closing){
				if(cur_open[marker.kind] == null){
					pushError(marker, `Attempt to close character environment of kind '${marker.kind}' but it is not currently open. Skipping marker`);
				} else {
					closeTagType(marker.kind, t_idx);
				}
			} else if(!marker.nested){
				closeCharacterMarkers(t_idx);
			}
		}

		result.text += marker.text || "";
		switch(marker.kind){
				////////////////////////////////////////////////////////////////////////
				// PARAGRAPHS
			case 'p'  : // normal paragraph
			case 'm'  : // margin paragraph (no first line indent)
			case 'po' : // paragraph to open  epistle/letter
			case 'cls': // paragraph to close epistle/letter
			case 'pr' : // right aligned paragraph
			case 'pc' : // center aligned paragraph
			case 'pmo': // embedded text opening
			case 'pm' : // embedded text paragraph
			case 'pmc': // embedded text closing
			case 'pmr': // embedded text refrain
			case 'mi' : // indented flush left (IE: justified text) paragraph
			case 'nb' : // no break paragraph, use to continue previous (eg, over chapter boundary)
			case 'tr' : // table row (not in p namespace, but behaves in the same way)
				closeTagType('p', t_idx);
				closeTagType('q', t_idx); // poetry doesn't span paragraphs
				closeTagType('l', t_idx); // lists  don't   span paragraphs
				closeTagType('t', t_idx); // tables
				closeTagType('s', t_idx); // labels, sections, etc
				cur_open['p'] = {
					kind: marker.kind, min: t_idx, max : t_idx,
					attributes: marker.attributes,
				};
				break;

			case 'pi': // indented paragraph
			case 'ph': // indented with hanging indent, depreacted, use \li#
				closeTagType('p', t_idx);
				closeTagType('q', t_idx); // poetry doesn't span paragraphs
				try {
					let level = _levelOrThrow(marker, pushError);
					cur_open['p'] = {
						kind: marker.kind, min: t_idx, max : t_idx, indent: level || 1,
						attributes: marker.attributes,
					};
				} catch (e) {}
				break;

				////////////////////////////////////////////////////////////////////////
				// Sections, titles, etc
			case 'sr':
			case 'r':
			case 'd':
			case 'sp':
				closeTagType('p', t_idx);
				closeTagType('q', t_idx);
				closeTagType('l', t_idx);
				closeTagType('t', t_idx);
				closeTagType('s', t_idx);
				closeTagType('v', t_idx);

				cur_open['s'] = {
					kind: marker.kind, min: t_idx, max : t_idx,
					attributes: marker.attributes,
				};
				break;

			case 's':
			case 'sd':
			case 'ms':
				closeTagType('p', t_idx);
				closeTagType('q', t_idx);
				closeTagType('l', t_idx);
				closeTagType('t', t_idx);
				closeTagType('s', t_idx);
				closeTagType('v', t_idx);

				let level = _levelOrThrow(marker, pushError);
				cur_open['s'] = {
					kind: marker.kind, min: t_idx, max : t_idx, level: level || 1,
					attributes: marker.attributes,
				};
				break;

				////////////////////////////////////////////////////////////////////////
				// VERSES
			case 'v':
				closeTagType('v', t_idx);
				if(marker.data === undefined){
					pushError(marker, "Expected verse marker to have verse number as data");
				} else {
					let v_data = parseIntOrRange(marker.data);

					if(!v_data){
						pushError(marker, "Invalid format for verse marker's data, wanted integer or integer range, got: '" + marker.data + "'");
					} else {
						let vref : BibleRef = (
							v_data.is_range ?
								{ is_range: true,
									start   : { book: book_id, chapter: chapter_num, verse: v_data.start },
									end     : { book: book_id, chapter: chapter_num, verse: v_data.end },
								} :
								{ book: book_id, chapter: chapter_num, verse: v_data.value }
						);
						cur_open['v'] = { kind: 'v', min: t_idx, max : t_idx, ref: vref,
															attributes: marker.attributes,
														};
					}
				}
				break;

				////////////////////////////////////////////////////////////////////////
				// POETRY
			case 'q':  // poetry, indent given by marker.level
			case 'qm': // embedded poetry, indent given by marker.level
				closeTagType('q', t_idx);
				closeTagType('s', t_idx); // labels, sections, etc
				try {
					let level = _levelOrThrow(marker, pushError);
					cur_open['q'] = {
						min: t_idx, max : t_idx, kind: marker.kind, indent: level || 1,
						attributes: marker.attributes,
					};
				} catch (e) {}
				break;
			case 'qr': // poetry, right aligned
			case 'qc': // poetry, center aligned
			case 'qa': // poetry acrostic heading
			case 'qd': // poetry closing note (eg, "for the director of music" at end of psalms)
				closeTagType('q', t_idx);
				cur_open['q'] = {
					min: t_idx, max: t_idx, kind: marker.kind,
					attributes: marker.attributes,
				};
				break;

				////////////////////////////////////////////////////////////////////////
				// Lists
			case 'lh':
			case 'lf':
				closeTagType('l', t_idx); // close open list elements
				closeTagType('p', t_idx); // close paragraphs
				closeTagType('q', t_idx); // close poetry
				closeTagType('s', t_idx); // labels, sections, etc
				cur_open['l'] = {
					min: t_idx, max: t_idx, kind: marker.kind,
					attributes: marker.attributes,
				};
				break;
			case 'li':
			case 'lim':
				closeTagType('l', t_idx); // close other list elements
				closeTagType('p', t_idx); // close paragraphs
				closeTagType('t', t_idx); // close tables
				try {
					let level = _levelOrThrow(marker, pushError);
					cur_open['l'] = {
						min: t_idx, max: t_idx, kind: marker.kind, indent: level || 1,
						attributes: marker.attributes,
					};
				} catch (e) {}
				break;
			case 'liv':
				if(marker.closing){
					break; // auto closing already handled
				} else {
					try {
						let level = _levelOrThrow(marker, pushError);
						cur_open[marker.kind] = {
							min: t_idx, max: t_idx, kind: marker.kind, column: { is_range: false, value: level || 1 },
							attributes: marker.attributes,
						};
					} catch (e) {}
				}
				break;

				////////////////////////////////////////////////////////////////////////
				// Table Cells
			case 'th':
			case 'thr':
			case 'tc':
			case 'tcr':
				closeTagType('t', t_idx);
				cur_open['t'] = {
					min: t_idx, max: t_idx, kind: marker.kind, column: marker.level || { is_range: false, value: 1 },
					attributes: marker.attributes,
				};
				break;

				////////////////////////////////////////////////////////////////////////
				// PAIRED MARKERS (with no data)

			case 'qac':
			case 'qs':
			case 'lik':
			case 'litl':
			case 'add':
			case 'bk':
			case 'dc':
			case 'k':
			case 'lit':
			case 'nd':
			case 'ord':
			case 'pn':
			case 'png':
			case 'addpn': // :TODO: this deprecated by usfm 3.0, should be mapped to \add \+pn ..... \+pn* \add*
			case 'qt':
			case 'sig':
			case 'sls':
			case 'tl':
			case 'wj':
			case 'em':
			case 'bd':
			case 'it':
			case 'bdit': // :TODO: map this to \bd \+it ... \+it* \bd*
			case 'no':
			case 'sc':
			case 'sup':
			case 'ndx':
			case 'rb':
			case 'pro':
			case 'w':
			case 'wg':
			case 'wh':
			case 'wa':
			case 'fig':
			case 'rq':
			case 'vp':
				if(marker.closing){
					break; // logic already handled by automatic character marker closing
				} else {
					cur_open[marker.kind] = {
						min: t_idx, max: t_idx, kind: marker.kind,
						attributes: marker.attributes,
					};
				}
				break;

				////////////////////////////////////////////////////////////////////////
				// MISC
			case 'b':
				closeTagType('p', t_idx);
				closeTagType('q', t_idx);
				closeTagType('l', t_idx);
				if(marker.text !== undefined || marker.data !== undefined){
					pushError(marker, "\\b marker (blank line) must not have associated text or data content - content will be skipped");
				}
				result.styling.push({ kind: 'b', min: t_idx, max: t_idx });
				break;


				////////////////////////////////////////////////////////////////////////

			default:
				console.log("WARNING - skipping unknown marker: " + marker.kind);
				break;
		}
	}

	// Close all outstanding blocks implicity at end of chapter
	let max = result.text.length;
	for(let k of Object.keys(cur_open)){
		closeTagType(k, max);
	}

	sortStyleBlocks(result.styling);
	return result;
}

function _assignTocValue(toc    : TableOfContentsEntry,
												 marker : Marker,
												 pushError : (a: Marker, b: string) => void
												){
	switch((marker.level as any).value){
		case undefined:
		case 1:
			toc.long_text = marker.text;
			break;
		case 2:
			toc.short_text = marker.text;
			break;
		case 3:
			toc.abbreviation = marker.text;
			break;
		default:
			pushError(
				marker,
				"Invalid level for toc tag, expected 1, 2 or 3, got: " + marker.level
			);
			break;
	}
}

function _assignLeveledData<T>(ld    : LeveledData<T>,
															 level : number | undefined,
															 value : T
															){
	if(level === undefined){
		level = 1;
	}
	ld[level] = value;
}

/**
 * Utility wrapper which returns marker.level, unless it is
 * an is_range object, in which case it pushes and error and throws
 * an exception
 */
function _levelOrThrow(marker    : Marker,
											 pushError : (m: Marker, err: string   ) => void,
											) : number | undefined {


	if(marker.level === undefined){ return undefined; }

	if(marker.level.is_range){
		let message = `Expected integer level for marker ${marker.kind} but got range`;
		pushError(marker, message);
		throw new Error(message);
	} else {
		return marker.level.value;
	}

}
