const assert = require('assert');

const Utils = require('./Utils');
const Vector = require('./Vector');
const Maths = require('./Maths');

class ProofFactory {

    /**
     * Compute a Bulletproof. The code is structured after a popular Bulletproof library implemented in Rust.
     * You can find documentation and also learn how the proof works on
     * https://doc-internal.dalek.rs/bulletproofs/notes/range_proof/index.html
     *
     * @param v {BigInt} the value of the commitment. Please use BigInt not number
     * @param bf {BigInt} blinding factor used in the commitment
     * @param V {Point} pedersen commitment for which we want to compute the rangeproof, which
     *                  has to be a valid commitement to v with blinding factor B
     * @param G {Point} generator G used in pedersen
     * @param H {Point} generator H used in pedersen
     * @param lowBound {BigInt} the lower bound of the rangeproof. Please use BigInt not number
     * @param upBound {BigInt} the upper bound of the rangeproof. Please use BigInt not number
     * @param p {BigInt} elliptic curve mod used for computation of the proof
     * @param doAssert {boolean} if we should do asserts. Should be set to false in production for performance gains
     * @param randomNum {boolean|function} optional random bigint generating function
     * @return {RangeProof} Final rangeproof which can be verified
     */
    static computeBulletproof(v, bf, V, G, H, lowBound, upBound, p, doAssert=true, randomNum=false) {

        if( typeof v !== "bigint" || typeof  bf !== "bigint" || typeof lowBound !== "bigint" || typeof upBound !== "bigint" ) {
            throw new Error("Parameters val, x, low and upper bound have to be bigints");
        }
        if( lowBound !== 0n ) {
            throw new Error("Currently only range proofs with lower bound 0 are supported");
        }
        if( (upBound % 2n) !== 0n ) {
            throw new Error("Upper bound has to be a power of 2");
        }
        if( v < lowBound || v > upBound ) {
            throw new Error("val must be in the range [lowBound, upBound]");
        }
        const binary = v.toString(2);

        // Vector 1 contains the value in binary
        const vec1 = new Vector(p);
        for( let i = binary.length -1; i >= 0; i-- ) {
            const v = binary[i];
            vec1.addElem(BigInt(v))
        }

        // Vector 2 contains powers of 2 up to our upper bound
        const vec2 = new Vector(p);
        let pow = 0n;
        while ((2n ** pow) <= upBound) {
            vec2.addElem(2n ** pow);
            pow++;
        }
        const n = BigInt(vec2.length());

        if( doAssert ) assert(vec1.length() <= vec2.length(), "Vector 1 length can't be greater then vec2");
        while ( vec1.length() < vec2.length() ) {
            vec1.addElem(0n);
        }
        if( doAssert ) assert(vec1.length() === vec2.length(), "Vectors now have to be same length");
        // Now val can be represented as val = < vec1, vec2 >
        if( doAssert ) assert(vec1.multVectorToScalar(vec2) === v, "Now val has t obe < vec1, vec2 >");

        // To match notation with reference
        const a_L = vec1;
        const a_R = vec1.subScalar(1n);
        if( doAssert ) assert(a_L.multVectorToScalar(a_R) === 0n, "a_L * a_R has to be 0, as a_L can only contain 0, or 1");

        /*
        * Now we want to prove three statements
        * < a_L, 2^n > = v (the binary vector representation times a vector containing powers of 2 will result in the original number)
        * a_L * a_R = 0
        * (a_L -1) - a_R = 0 (Those two statements prove that a_L contains only 1 and 0)
        *
        * To make the prove really compact we want to combine these statements
        * into one single vector product.
        * We can do this by utilizing two challenges from the verifier y and z
        * To make the prove interactive we use Fiat Shamir Heuristic, while we always hash a commitment
        * to get the next random challenge, the first commitment is our pedersen commitment.
        * To understand the details of the math on who the 3 statements are combined check
        * https://doc-internal.dalek.rs/bulletproofs/notes/range_proof/index.html
        */

        const y = Utils.getFiatShamirChallenge(V, p);
        const y_n = Vector.getVectorToPowerN( y, BigInt(a_L.length()) );
        if( doAssert ) assert(y_n.length() === a_L.length() && y_n.length() === a_R.length(), "All vectors should be same length");

        const yP = Utils.scalarToPoint(y.toString(16));
        const z = Utils.getFiatShamirChallenge(yP, p);
        const zsq = Maths.mod(z ** 2n, p);

        const twos_times_zsq = vec2.multWithScalar(zsq);

        // Unblinded version
        const a_R_plusz = a_R.addScalar(z);

        const l0 = a_L.subScalar(z);
        const r0 = y_n.multVector(a_R_plusz).addVector(twos_times_zsq);

        /**
         * Function delta which can be computed from all
         * non secret terms
         *
         * @param yn {Vector} vector of challenge param y^n
         * @param z {BigInt} challenge param z
         * @param mod {BigInt|boolean} if set it the result will be
         *                             modulos mod
         * @return {BigInt} result of computation
         */
        const delta = (yn, z, mod=false) => {
            if( mod && typeof mod !== 'bigint' ) {
                throw new Error("Please supply bigint as mod parameter");
            }
            const ones = Vector.getVectorWithOnlyScalar(1n, yn.length());
            const twopown = Vector.getVectorToPowerN(2n, BigInt(yn.length()));
            const left = (z - z ** 2n) * ones.multVectorToScalar(yn);
            const right = z ** 3n * ones.multVectorToScalar(twopown);
            const result = left - right;
            if( mod ) { return result % mod }
            return result;
        };

        if( doAssert ) {
            const lefthandside = Maths.mod(zsq * v + delta(y_n, z), p);
            const righthandside = Maths.mod(l0.multVectorToScalar(r0), p);

            // Now we got a single vector product proving our 3 statements which can be easily verified
            // as is done below:
            assert(lefthandside === righthandside, "Non secret terms should equal the multiplication of the vectors");
        }

        // However we can't sent this two vectors to the verifier since it would leak information about v.
        // Note that the inner-product argument which is actually transmitted instead of the full vectors
        // are not zero-knowledge and therefore can't be used either.
        // Therefore we need to introduce additional blinding factors
        const s_L = new Vector(p);
        const s_R = new Vector(p);
        if( !randomNum ) {
            const Rand = require('./Rand');
            randomNum = Rand.secureRandomBigInt;
        }
        for( let i = 0; i < n; i++ ) {
            const r1 = randomNum(p);
            const r2 = randomNum(p);
            s_L.addElem(r1);
            s_R.addElem(r2);
        }

        // The blinded l(x) and r(x) have a_L and a_R replaced by
        // blinded terms a_L + s_L*x and a_R + s_R*x

        /**
         * Vector polynomial l(x) which is a_L blinded
         * by s_L
         *
         * @param x {BigInt} random number
         * @return {Vector}
         */
        const l = (x) => {
            return a_L.addVector(s_L.multWithScalar(x)).subScalar(z)
        };

        /**
         * Vector polynomial r(y) which is a_R blinded
         * by s_R
         *
         * @param x {BigInt} random number
         * @return {Vector}
         */
        const r = (x) => {
            return y_n.multVector(a_R.addVector(s_R.multWithScalar(x)).addScalar(z)).addVector(twos_times_zsq)
        };

        /**
         * Term t of the form
         * t_0 + t_1x + t_2x²
         * Whereas t_0 is our unblinded version
         *
         * @param x {BigInt}
         * @return {BigInt}
         */
        const t = (x) => {
            return l(x).multVectorToScalar(r(x));
        };

        // Now we need to commit to T1 = Com(t1), and T2 = Com(t2)
        // Together with V (our original commitment) those are sent to the verifier
        const l1 = s_L.clone();
        const r1 = y_n.multVector(s_R);

        const t0 = Maths.mod(l0.multVectorToScalar(r0), p);
        const t2 = Maths.mod(l1.multVectorToScalar(r1), p);
        const t1 = Maths.mod(l0.addVector(l1).multVectorToScalar(r0.addVector(r1)) - t0 - t2, p);

        const t1_bf = randomNum(p);
        const T1 = Utils.getPedersenCommitment(t1, t1_bf, H);

        const t2_bf = randomNum(p);
        const T2 = Utils.getPedersenCommitment(t2, t2_bf, H);

        // Now we get the challenge point x
        const zP = Utils.scalarToPoint(z.toString(16));
        const x = Utils.getFiatShamirChallenge(zP, p);

        const xsq = Maths.mod(x ** 2n, p);
        const tx = Maths.mod(t0 + t1 * x + t2 * xsq, p);
        const tx_bf = Maths.mod(zsq * bf + x * t1_bf + t2_bf * xsq, p);
        // Send openings tx and tx_bf back to the verifier

        if( doAssert ) {
            const d = delta(y_n, z, p);
            const Bdelta = Utils.toBN(d);
            const Bzsq = Utils.toBN(zsq);
            const Bx = Utils.toBN(x);
            const Bxsq = Utils.toBN(xsq);

            // Check the three equalities of the terms
            assert(Utils.getPedersenCommitment(zsq * v, zsq * bf).eq(V.mul(Bzsq)), "partial equality 1 of the term");
            assert(Utils.getPedersenCommitment(zsq * v, zsq * bf).add(G.mul(Bdelta)).eq(V.mul(Bzsq).add(G.mul(Bdelta))), "partial equality 2 of the term");
            //assert(Utils.getPedersenCommitment(t0, zsq * bf).eq(V.mul(Bzsq).add(G.mul(Bdelta))), "partial equality 3 of the term");
            assert(Utils.getPedersenCommitment(x * t1, x * t1_bf).eq(T1.mul(Bx), "partial equality 4 of the term"));
            assert(Utils.getPedersenCommitment(xsq * t2, xsq * t2_bf).eq(T2.mul(Bxsq), "partial equality 5 of the term"));


            const leftEq = Utils.getPedersenCommitment(tx, tx_bf, H);
            const rightEq = V.mul(Utils.toBN(zsq)).add(G.mul(Utils.toBN(delta(y_n, z)))).add(T1.mul(Utils.toBN(x))).add(T2.mul(Utils.toBN(xsq)));
            assert(leftEq.eq(rightEq), "Final equality the verifier checks to verify t(x) is correct polynomial");
        }
    }
}

module.exports = ProofFactory;