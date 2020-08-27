//--------------------------------------
//  Setup
//--------------------------------------

export interface Validator<T> {
  readonly T: T // Phantom type

  validate(value: Value, config?: Configuration, context?: Context): Validation<T>

  map<B>(fn: (value: T) => B): Validator<B>
  filter(fn: (value: T) => boolean): Validator<T>
  flatMap<B>(fn: (value: T) => Result<string, B>): Validator<B>
  transform<B>(fn: (result: Validation<T>) => Result<string | ValidationError[], B>): Validator<B>
  tagged<TAG extends string>(this: Validator<string>): Validator<TAG>
  tagged<TAG extends number>(this: Validator<number>): Validator<TAG>
}

const validatorMethods = {
  map<B>(fn: (value: Value) => B): Validator<B> {
    return this.flatMap(v => Ok(fn(v)))
  },

  filter(fn: (value: Value) => boolean): Validator<unknown> {
    return this.flatMap(v => fn(v) ? Ok(v) : Err(`filter error: ${pretty(v)}"`))
  },

  flatMap<B>(fn: (value: Value) => Result<string, B>): Validator<B> {
    return this.transform(r => isOk(r) ? fn(r.value) : r)
  },

  transform<B>(fn: (result: Validation<Value>) => Result<string | ValidationError[], B>): Validator<B> {
    const validator = this as Validator<Value>

    return Object.assign({}, validatorMethods, {
      validate(v: Value, config: Configuration = defaultConfig, c: Context = rootContext) {
        const validated = validator.validate(v, config, c)
        const transformed = fn(validated)

        if (isOk(transformed))
          return success(transformed.value)
    
        const error = transformed.errors
    
        if (typeof error === 'string')
          return failure(c, error);
    
        return Err(error);
      }
    }) as Validator<B>
  },

  tagged<TAG>(): Validator<TAG> {
    return this as {} as Validator<TAG>
  }
}

export type Ok<VALUE> = {type: 'ok', value: VALUE}
export type Err<ERROR> = {type: 'error', errors: ERROR}
export type Result<ERROR, VALUE> = Err<ERROR> | Ok<VALUE> 

export function Ok<VALUE>(value: VALUE) {
  return {type: 'ok', value} as const
}

export function Err<ERROR>(errors: ERROR) {
  return {type: 'error', errors} as const
}

export function isOk<VALUE>(result: Result<unknown, VALUE>): result is Ok<VALUE> {
  return result.type === 'ok'
}

export type Any = Validator<Value>
export type TypeOf<V extends Any> = V['T']

export interface ValidationError {
  readonly message: string
  readonly context: Context
}

export type Value = Object | null | undefined

export type Context = string & { __tag: 'context' }

export type Configuration = {
  transformObjectKeys?: (key: string) => string
}

export type Validation<T> = Result<ValidationError[], T>


export function success<T>(value: T): Validation<T> {
  return Ok(value)
}

export function failure(context: Context, message: string): Validation<never> {
  return Err([{ context, message }])
}

export function typeFailure(value: any, context: Context, expectedType: string) {
  const valueType = (() => {
    if (Array.isArray(value)) return 'array'
    if (value === null) return 'null'
    return typeof value
  })()
  const message = `Expected ${expectedType}, got ${valueType}`
  return Err([{ context, message }])
}

export function getContext(name: string, parent?: string) {
  return (parent ? `${parent} / ${name}` : name) as Context
}

const rootContext = getContext('root')

const defaultConfig: Configuration = {}

const upperThenLower = /([A-Z]+)([A-Z][a-z])/g
const lowerThenUpper = /([a-z\\\\d])([A-Z])/g
export const snakeCaseTransformation = (key: string): string =>
  key
    .replace(upperThenLower, '$1_$2')
    .replace(lowerThenUpper, '$1_$2')
    .toLowerCase()

export function is<T>(value: Value, validator: Validator<T>): value is T {
  return isOk(validator.validate(value))
}

//--------------------------------------
//  Primitives
//--------------------------------------

const nullValidator = {
  validate: (v: Value, _config: Configuration = defaultConfig, c: Context = rootContext) =>
    v === null ? success(v as null) : typeFailure(v, c, 'null'),
  ...validatorMethods
} as any as Validator<null>

const undefinedValidator = {
  validate: (v: Value, _config: Configuration = defaultConfig, c: Context = rootContext) =>
    v === void 0 ? success(v as undefined) : typeFailure(v, c, 'undefined'),
  ...validatorMethods
} as any as Validator<undefined>

export const string = {
  validate: (v: Value, _config: Configuration = defaultConfig, c: Context = rootContext) =>
    typeof v === 'string' ? success(v) : typeFailure(v, c, 'string'),
  ...validatorMethods
} as any as Validator<string>

export const number = {
  validate: (v: Value, _config: Configuration = defaultConfig, c: Context = rootContext) =>
    typeof v === 'number' ? success(v) : typeFailure(v, c, 'number'),
  ...validatorMethods
} as any as Validator<number>

export const boolean = {
  validate: (v: Value, _config: Configuration = defaultConfig, c: Context = rootContext) =>
    typeof v === 'boolean' ? success(v) : typeFailure(v, c, 'boolean'),
  ...validatorMethods
} as any as Validator<boolean>

//--------------------------------------
//  array
//--------------------------------------

export function array<A>(validator: Validator<A>) {
  return {
    validate(v: Value, config: Configuration = defaultConfig, c: Context = rootContext) {
      if (!Array.isArray(v)) return typeFailure(v, c, 'array')
  
      const validatedArray: A[] = []
      const errors: ValidationError[] = []
  
      for (let i = 0; i < v.length; i++) {
        const item = v[i]
        const validation = validator.validate(item, config, getContext(String(i), c))
  
        if (isOk(validation)) {
          validatedArray.push(validation.value)
        }
        else {
          pushAll(errors, validation.errors)
        }
      }
  
      return errors.length ? Err(errors) : Ok(validatedArray)
    },
    ...validatorMethods
  } as any as Validator<A[]>
}

//--------------------------------------
//  tuple
//--------------------------------------

export function tuple<A = never>(): Validator<A[]>
export function tuple<A>(a: Validator<A>): Validator<[A]>
export function tuple<A, B>(a: Validator<A>, b: Validator<B>): Validator<[A, B]>
export function tuple<A, B, C>(a: Validator<A>, b: Validator<B>, c: Validator<C>): Validator<[A, B, C]>
export function tuple<A, B, C, D>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>): Validator<[A, B, C, D]>
export function tuple<A, B, C, D, E>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>, e: Validator<E>): Validator<[A, B, C, D, E]>
export function tuple<A, B, C, D, E, F>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>, e: Validator<E>, f: Validator<F>): Validator<[A, B, C, D, E, F]>
export function tuple<A, B, C, D, E, F, G>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>, e: Validator<E>, f: Validator<F>, g: Validator<G>): Validator<[A, B, C, D, E, F, G]>
export function tuple<A, B, C, D, E, F, G, H>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>, e: Validator<E>, f: Validator<F>, g: Validator<G>, h: Validator<H>): Validator<[A, B, C, D, E, F, G, H]>
export function tuple<A, B, C, D, E, F, G, H, I>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>, e: Validator<E>, f: Validator<F>, g: Validator<G>, h: Validator<H>, i: Validator<I>): Validator<[A, B, C, D, E, F, G, H, I]>
export function tuple<A, B, C, D, E, F, G, H, I, J>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>, e: Validator<E>, f: Validator<F>, g: Validator<G>, h: Validator<H>, i: Validator<I>, j: Validator<J>): Validator<[A, B, C, D, E, F, G, H, I, J]>
export function tuple<A, B, C, D, E, F, G, H, I, J, K>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>, e: Validator<E>, f: Validator<F>, g: Validator<G>, h: Validator<H>, i: Validator<I>, j: Validator<J>, k: Validator<K>): Validator<[A, B, C, D, E, F, G, H, I, J, K]>
export function tuple<A, B, C, D, E, F, G, H, I, J, K, L>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>, e: Validator<E>, f: Validator<F>, g: Validator<G>, h: Validator<H>, i: Validator<I>, j: Validator<J>, k: Validator<K>, l: Validator<L>): Validator<[A, B, C, D, E, F, G, H, I, J, K, L]>

export function tuple(...validators: any[]): any {
  return {
    validate(v: Value, config: Configuration = defaultConfig, c: Context = rootContext) {
      if (!Array.isArray(v)) return typeFailure(v, c, 'Tuple')
      if (v.length !== validators.length) return failure(c, `Expected Tuple${validators.length}, got Tuple${v.length}`)
  
      const validatedArray: any[] = []
      const errors: ValidationError[] = []
  
      for (let i = 0; i < v.length; i++) {
        const item = v[i]
        const validation = validators[i].validate(item, config, getContext(String(i), c))
  
        if (isOk(validation)) {
          validatedArray.push(validation.value)
        }
        else {
          pushAll(errors, validation.errors)
        }
      }
  
      return errors.length ? Err(errors) : Ok(validatedArray)
    },
    ...validatorMethods
  }
}

//--------------------------------------
//  object
//--------------------------------------

export type Props = Record<string, Any>

// Unpack helps TS inference. It worked without it in TS 3.0 but no longer does in 3.1.
type Unpack<P extends Props> = { [K in keyof P]: P[K]['T'] }
type OptionalKeys<T> = { [K in keyof T]: undefined extends T[K] ? K : never }[keyof T]
type MandatoryKeys<T> = { [K in keyof T]: undefined extends T[K] ? never : K }[keyof T]

export type ObjectOf<P extends Props> =
  { [K in MandatoryKeys<Unpack<P>>]: Unpack<P>[K] } &
  { [K in OptionalKeys<Unpack<P>>]?: Unpack<P>[K] }

export function object<P extends Props>(props: P) {
  return {
    props,
    validate(v: Value, config: Configuration = defaultConfig, c: Context = rootContext): Validation<ObjectOf<P>> {
      if (v == null || typeof v !== 'object') return typeFailure(v, c, 'object')
  
      const validatedObject: any = {}
      const errors: ValidationError[] = []
  
      for (let key in props) {
        const transformedKey = config.transformObjectKeys !== undefined
          ? config.transformObjectKeys(key)
          : key
  
        const value = (v as any)[transformedKey]
        const validator = props[key]
        const validation = validator.validate(value, config, getContext(transformedKey, c))
  
        if (isOk(validation)) {
          if (validation.value !== undefined)
            validatedObject[key] = validation.value
        }
        else {
          pushAll(errors, validation.errors)
        }
      }
      return errors.length ? Err(errors) : Ok(validatedObject)
    },
    ...validatorMethods
  } as any as Validator<ObjectOf<P>> & {props: P}
}

//--------------------------------------
//  keyof
//--------------------------------------

export function keyof<KEYS extends object>(keys: KEYS) {
  return {
    validate(v: Value, _config: Configuration = defaultConfig, c: Context = rootContext): Validation<keyof KEYS> {
      return keys.hasOwnProperty(v as string)
        ? success(v as any)
        : failure(c, `${pretty(v)} is not a key of ${pretty(keys)}`)
    },
    ...validatorMethods
  } as any as Validator<keyof KEYS>
}

//--------------------------------------
//  dictionary
//--------------------------------------

export function dictionary<K extends string, V>(
  domain: Validator<K>,
  codomain: Validator<V>) {

  return {
    validate(v: Value, config: Configuration = defaultConfig, c: Context = rootContext) {
      if (v == null || typeof v !== 'object') return typeFailure(v, c, 'object')
  
      const validatedDict: any = {}
      const errors: ValidationError[] = []
  
      for (let key in v) {
        const value = (v as any)[key]
  
        const context = getContext(key, c)
        const domainValidation = domain.validate(key, config, context)
        const codomainValidation = codomain.validate(value, config, context)
  
        if (isOk(domainValidation)) {
          key = domainValidation.value
        }
        else {
          const error = domainValidation.errors
          pushAll(errors, error.map(e => ({ context, message: `key error: ${e.message}` })))
        }
  
        if (isOk(codomainValidation)) {
          validatedDict[key] = codomainValidation.value
        }
        else {
          const error = codomainValidation.errors
          pushAll(errors, error.map(e => ({ context, message: `value error: ${e.message}` })))
        }
      }
      return errors.length ? Err(errors) : Ok(validatedDict)
    },
    ...validatorMethods
  } as any as Validator<Record<K, V>>
}

//--------------------------------------
//  literal
//--------------------------------------

export type Literal = string | number | boolean | null | undefined

export function literal<V extends Literal>(value: V) {
  return {
    validate(v: Value, _config: Configuration = defaultConfig, c: Context = rootContext) {
      return v === value
        ? success(v as V)
        : failure(c, `Expected ${pretty(value)}, got ${pretty(v)}`)
    },
    ...validatorMethods
  } as any as Validator<V>
}

//--------------------------------------
//  intersection
//--------------------------------------

export function intersection<A, B>(a: Validator<A>, b: Validator<B>): Validator<A & B>
export function intersection<A, B, C>(a: Validator<A>, b: Validator<B>, c: Validator<C>): Validator<A & B & C>
export function intersection<A, B, C>(a: Validator<A>, b: Validator<B>, c: Validator<C>): Validator<A & B & C>
export function intersection<A, B, C, D>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>): Validator<A & B & C & D>
export function intersection<A, B, C, D, E>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>, e: Validator<E>): Validator<A & B & C & D & E>
export function intersection<A, B, C, D, E, F>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>, e: Validator<E>, f: Validator<F>): Validator<A & B & C & D & E & F>

export function intersection(...validators: any[]): any {
  return {
    validate(v: Value, config: Configuration = defaultConfig, c: Context = rootContext) {
      let result: any = {}
  
      for (let i = 0; i < validators.length; i++) {
        const validation = validators[i].validate(v, config, c)
  
        if (isOk(validation)) {
          result = { ...result, ...validation.value as object }
        }
        else {
          return validation
        }
      }
  
      return success(result)
    },
    ...validatorMethods
  }
}

//--------------------------------------
//  union
//--------------------------------------

export function union<A, B>(a: Validator<A>, b: Validator<B>): Validator<A | B>
export function union<A extends Literal, B extends Literal>(a: A, b: B): Validator<A | B>

export function union<A, B, C>(a: Validator<A>, b: Validator<B>, c: Validator<C>): Validator<A | B | C>
export function union<A extends Literal, B extends Literal, C extends Literal>(a: A, b: B, c: C): Validator<A | B | C>

export function union<A, B, C, D>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>): Validator<A | B | C | D>
export function union<A extends Literal, B extends Literal, C extends Literal, D extends Literal>(a: A, b: B, c: C, d: D): Validator<A | B | C | D>

export function union<A, B, C, D, E>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>, e: Validator<E>): Validator<A | B | C | D | E>
export function union<A extends Literal, B extends Literal, C extends Literal, D extends Literal, E extends Literal>(a: A, b: B, c: C, d: D, e: E): Validator<A | B | C | D | E>

export function union<A, B, C, D, E, F>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>, e: Validator<E>, f: Validator<F>): Validator<A | B | C | D | E | F>
export function union<A extends Literal, B extends Literal, C extends Literal, D extends Literal, E extends Literal, F extends Literal>(a: A, b: B, c: C, d: D, e: E, f: F): Validator<A | B | C | D | E | F>

export function union<A, B, C, D, E, F, G>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>, e: Validator<E>, f: Validator<F>, g: Validator<G>): Validator<A | B | C | D | E | F | G>
export function union<A extends Literal, B extends Literal, C extends Literal, D extends Literal, E extends Literal, F extends Literal, G extends Literal>(a: A, b: B, c: C, d: D, e: E, f: F, g: G): Validator<A | B | C | D | E | F | G>

export function union<A, B, C, D, E, F, G, H>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>, e: Validator<E>, f: Validator<F>, g: Validator<G>, h: Validator<H>): Validator<A | B | C | D | E | F | G | H>
export function union<A extends Literal, B extends Literal, C extends Literal, D extends Literal, E extends Literal, F extends Literal, G extends Literal, H extends Literal>(a: A, b: B, c: C, d: D, e: E, f: F, g: G, h: H): Validator<A | B | C | D | E | F | G | H>

export function union<A, B, C, D, E, F, G, H, I>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>, e: Validator<E>, f: Validator<F>, g: Validator<G>, h: Validator<H>, i: Validator<I>): Validator<A | B | C | D | E | F | G | H | I>
export function union<A extends Literal, B extends Literal, C extends Literal, D extends Literal, E extends Literal, F extends Literal, G extends Literal, H extends Literal, I extends Literal>(a: A, b: B, c: C, d: D, e: E, f: F, g: G, h: H, i: I): Validator<A | B | C | D | E | F | G | H | I>

export function union<A, B, C, D, E, F, G, H, I, J>(a: Validator<A>, b: Validator<B>, c: Validator<C>, d: Validator<D>, e: Validator<E>, f: Validator<F>, g: Validator<G>, h: Validator<H>, i: Validator<I>, j: Validator<J>): Validator<A | B | C | D | E | F | G | H | I | J>
export function union<A extends Literal, B extends Literal, C extends Literal, D extends Literal, E extends Literal, F extends Literal, G extends Literal, H extends Literal, I extends Literal, J extends Literal>(a: A, b: B, c: C, d: D, e: E, f: F, g: G, h: H, i: I, j: J): Validator<A | B | C | D | E | F | G | H | I | J>

export function union(...validators: any[]): any {
  const probe = validators[0]

  if (probe && typeof probe === 'object') {
    return {
      validate(v: Value, config: Configuration = defaultConfig, c: Context = rootContext) {
        const errors: ValidationError[][] = []
    
        for (let i = 0; i < validators.length; i++) {
          const validation = validators[i].validate(v, config, c)
          if (isOk(validation))
            return validation
          else
            errors.push(validation.errors)
        }

        const detailString = errors.map((es, index) =>
          `Union type #${index} => \n  ${errorDebugString(es).replace(/\n/g, '\n  ')}`).join('\n')
    
        return failure(c, `The value ${pretty(v)} \nis not part of the union: \n\n${detailString}`)
      },
      ...validatorMethods
    }
  }

  return {
    validate(v: Value, config: Configuration = defaultConfig, c: Context = rootContext) {
      for (let i = 0; i < validators.length; i++) {
        const validator = literal(validators[i])
        const validation = validator.validate(v, config, c)
        if (isOk(validation)) return validation
      }
      return failure(c, `The value ${pretty(v)} is not part of the union`)
    },
    ...validatorMethods
  }

}

//--------------------------------------
//  optional
//--------------------------------------

export function optional<V>(validator: Validator<V>) {
  return {
    validate(v: Value, config: Configuration = defaultConfig, c: Context = rootContext) {
      if (v === undefined) return success(v as undefined)
      return validator.validate(v, config, c)
    },
    ...validatorMethods
  } as any as Validator<V | undefined>
}

//--------------------------------------
//  recursion
//--------------------------------------

export function recursion<T>(definition: (self: Validator<T>) => Any): Validator<T> {
  const Self = {
    ...validatorMethods,
    validate: (v: Value, config: Configuration = defaultConfig, c: Context = rootContext) =>
      Result.validate(v, config, c)
  } as Validator<T>
  const Result: any = definition(Self)
  return Result
}

//--------------------------------------
//  isoDate
//--------------------------------------

export const isoDate = string.flatMap(str => {
  const date = new Date(str)
  return isNaN(date.getTime())
    ? Err(`Expected ISO date, got: ${pretty(str)}`)
    : Ok(date)
});

//--------------------------------------
//  util
//--------------------------------------

function pushAll<A>(xs: A[], ys: A[]) {
  Array.prototype.push.apply(xs, ys)
}

function pretty(value: Value) {
  return JSON.stringify(value, undefined, 2)
}

export function errorDebugString(errors: ValidationError[]) {
  return errors.map(e => `At [${e.context}] ${e.message}`).join('\n')
}

//--------------------------------------
//  Export aliases
//--------------------------------------

export {
  nullValidator as null,
  undefinedValidator as undefined
}