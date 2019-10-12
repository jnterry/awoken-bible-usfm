import { Marker } from './marker';
import { lexer  } from './lexer';

interface TableOfContentsEntry {
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
 * Represents an error message produced by the parser
 */
type ParserError = {
	message : string,
	marker  : Marker,
};

interface StyleBlockBase {
	/**
	 * Minimum extent of the styling as expressed in "gap index" (gap 0 is before
	 * first character, gap 1 is after first character, thus a StyleBlock from 0
	 * to 1 applies to just the first character)
	 */
	min : number;

	/*
	 * Maximum extent of the styling as expressed in "gap index"
	 */
	max : number;
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
	  // misc
	  "b" // blank line (between paragraphs or poetry)
	);
};

/**
 * Represents a region of text making up a single verse
 */
interface StyleBlockVerse extends StyleBlockBase{
	kind : "v";

	data : {
		verse : number,
	} | {
		is_range : true,
		start    : number,
		end      : number,
	};
};

interface StyleBlockIndented extends StyleBlockBase {
	kind : "q" | "qm" | "pi" | "ph" | "li" | "lim";

	data : {
		indent : number,
	},
}

interface StyleBlockColumn extends StyleBlockBase {
	// https://ubsicap.github.io/usfm/lists/index.html#liv-liv
	// https://ubsicap.github.io/usfm/tables/index.html#th
	//
	// Represents elements with an associated column number,
	// eg in tables or key/value lists
	kind: "liv" | "th" | "thr" | "tc" | "tcr";
	data: {
		column: number | { is_range: true, start: number, end: number },
	}
}

type StyleBlock = (StyleBlockNoData    |
									 StyleBlockVerse     |
									 StyleBlockIndented  |
									 StyleBlockColumn
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

type ParseResultBook = {
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
	let marker_yield_val : IteratorResult<Marker>;
	let marker : Marker = { kind: '' };
	while(parsing_headers){
		marker_yield_val = lex_iter.next();
		if(marker_yield_val.done){ return result; }
		marker = marker_yield_val.value;

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
			default:
				pushError(marker, "Unexpected marker in book header section");
				return { success: false,
								 errors : result.errors
							 };

		} // end of switch marker.kind
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
	// Actually parse the chapter's
	result.chapters = chapter_markers.map(chapterParser);

	return result;
}

function chapterParser(markers : Marker[]) : ParseResultChapter {

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

	function pushError(marker: Marker, message: string){
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
				break;
		} // end of switch marker.kind
	}

	result.body = bodyParser(markers.slice(m_idx-1), pushError);

	return result;
}

function bodyParser(markers : Marker[],
										pushError : (m: Marker, e: string) => void
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
			result.styling.push(cur_open[kind]);
			delete cur_open[kind];
		}
	}

	let marker : Marker | undefined;
	while(marker = markers.shift()){

		let t_idx = result.text.length; // newly opened sections begin after the space character

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
				result.text += marker.text || "";
				cur_open['p'] = {
					kind: marker.kind, min: t_idx, max : t_idx,
				};
				break;

			case 'pi': // indented paragraph
			case 'ph': // indented with hanging indent, depreacted, use \li#
				closeTagType('p', t_idx);
				closeTagType('q', t_idx); // poetry doesn't span paragraphs
				result.text += marker.text || "";
				try {
					let level = _levelOrThrow(marker, pushError);
					cur_open['p'] = {
						kind: marker.kind, min: t_idx, max : t_idx, data: { indent: level || 1 }
					};
				} catch (e) {}
				break;

				////////////////////////////////////////////////////////////////////////
				// VERSES
			case 'v':
				result.text += marker.text || "";
				closeTagType('v', t_idx);
				if(marker.data === undefined){
					pushError(marker, "Expected verse marker to have verse number as data");
				} else if (marker.data.match(/^\d+$/)) {
					cur_open['v'] = {
						kind: 'v', min: t_idx, max : t_idx,
						data: { verse: parseInt(marker.data) },
					};
				} else if (marker.data.match(/^\d+-\d+$/)) {
					let parts = marker.data.split('-');
					cur_open['v'] = {
						kind: 'v', min: t_idx, max : t_idx,
						data: { is_range : true,
										start    : parseInt(parts[0]),
										end      : parseInt(parts[1])
									},
					};
				} else {
					pushError(marker, "Invalid format for verse marker's data, wanted integer or integer range, got: '" + marker.data + "'");
				}
				break;

				////////////////////////////////////////////////////////////////////////
				// POETRY
			case 'q':  // poetry, indent given by marker.level
			case 'qm': // embedded poetry, indent given by marker.level
				result.text += marker.text || "";
				closeTagType('q', t_idx);
				try {
					let level = _levelOrThrow(marker, pushError);
					cur_open['q'] = {
						min: t_idx, max : t_idx, kind: marker.kind,
						data: { indent: level || 1 }
					};
				} catch (e) {}
				break;
			case 'qr': // poetry, right aligned
			case 'qc': // poetry, center aligned
			case 'qa': // poetry acrostic heading
			case 'qd': // poetry closing note (eg, "for the director of music" at end of psalms)
				closeTagType('q', t_idx);
				result.text += marker.text || "";
				cur_open['q'] = {
					min: t_idx, max: t_idx,
					kind: marker.kind,
				};
				break;

				////////////////////////////////////////////////////////////////////////
				// Lists
			case 'lh':
			case 'lf':
				result.text += marker.text || "";
				closeTagType('l', t_idx); // close open list elements
				closeTagType('p', t_idx); // close paragraphs
				cur_open['l'] = {
					min: t_idx, max: t_idx, kind: marker.kind
				};
				break;
			case 'li':
			case 'lim':
				result.text += marker.text || "";
				closeTagType('l', t_idx); // close other list elements
				closeTagType('p', t_idx); // close paragraphs
				closeTagType('t', t_idx); // close tables
				try {
					let level = _levelOrThrow(marker, pushError);
					cur_open['l'] = {
						min: t_idx, max: t_idx, kind: marker.kind, data: { indent: level || 1 }
					};
				} catch (e) {}
				break;
			case 'liv':
				if(marker.closing){
					result.text += marker.text || "";
					if(cur_open[marker.kind] === undefined){
						pushError(marker, `Attempt to close paired makrer of kind ${marker.kind}, but the environment is not currently open`);
					} else {
						closeTagType(marker.kind, t_idx);
					}
				} else {
					if(result.text){
						result.text += marker.text;
					}
					try {
						let level = _levelOrThrow(marker, pushError);
						cur_open[marker.kind] = {
							min: t_idx, max: t_idx, kind: marker.kind,
							data: { column: level || 1 }
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
				result.text += marker.text || "";
				closeTagType('t', t_idx);
				cur_open['t'] = {
					min: t_idx, max: t_idx, kind: marker.kind,
					data: { column: marker.level || 1 }
				};
				break;

				////////////////////////////////////////////////////////////////////////
				// PAIRED MARKERS

			case 'qac':
			case 'qs':
			case 'lik':
			case 'litl':
				if(marker.closing){
					result.text += marker.text || "";
					if(cur_open[marker.kind] === undefined){
						pushError(marker, `Attempt to close paired makrer of kind ${marker.kind}, but the environment is not currently open`);
					} else {
						closeTagType(marker.kind, t_idx);
					}
				} else {
					if(result.text){
						result.text += " " + marker.text;
					}
					cur_open[marker.kind] = {
						min: t_idx, max: t_idx, kind: marker.kind
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
		if(cur_open[k] == null){ continue; }
		cur_open[k].max = max;
		result.styling.push(cur_open[k]);
	}

	_sortStyleBlocks(result.styling);
	return result;
}

function _sortStyleBlocks(styling : StyleBlock[]) : StyleBlock[] {
	styling.sort((a,b) => {
		if(a.min == b.min){
			if(b.max == a.max){
				// :TODO: this isn't really nessacery, except for ensuring fully
				// consistant sort order for unit tests
				// (without this blocks with same min and max are indistinguishable,
				//  so sorting depends on input order)
				return a.kind.localeCompare(b.kind);
			} else {
				return b.max - a.max;
			}
		}
		return a.min - b.min;
	});
	return styling;
}


function _assignTocValue(toc    : TableOfContentsEntry,
												 marker : Marker,
												 pushError : (a: Marker, b: string) => void
												){
	switch(marker.level){
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

	if(marker.level === undefined || typeof marker.level === typeof 1){
		return marker.level as number | undefined;
	}

	let message = `Expected integer level for marker ${marker.kind} but got range`;
	pushError(marker, message);
	throw new Error(message);
}
